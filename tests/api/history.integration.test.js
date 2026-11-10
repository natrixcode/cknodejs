import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createSession } from '../../src/utils/sessions.js';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test('History and audit log HTTP API integration (Issue #55)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_api_history_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let db;
  let server;
  let created = false;
  let connected = false;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    process.env.PGDATABASE = dbName;

    const { default: app } = await import('../../src/app.js');
    db = new Client({ database: dbName });
    await db.connect();

    // Create Admin and Manager users
    const users = await db.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES
         ('hist_admin', 'hash', 'admin'),
         ('hist_manager', 'hash', 'manager')
       RETURNING id, role`
    );

    const adminUser = users.rows.find((u) => u.role === 'admin');
    const managerUser = users.rows.find((u) => u.role === 'manager');

    const adminToken = createSession(adminUser.id).token;
    const managerToken = createSession(managerUser.id).token;

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    async function req(method, path, userToken, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      const resBody = await response.json().catch(() => null);
      return { status: response.status, body: resBody };
    }

    // Admin creates a child via API (which should log adminUser.id as actor_user_id)
    const createChildRes = await req('POST', '/children', adminToken, {
      first_name: 'AuditTest',
      last_name: 'Child',
      date_of_birth: '2023-05-10',
    });
    assert.equal(createChildRes.status, 201);
    const childId = createChildRes.body.data.id;

    // Admin updates the child via API
    const updateChildRes = await req('PATCH', `/children/${childId}`, adminToken, {
      notes: 'Updated notes by admin',
    });
    assert.equal(updateChildRes.status, 200);

    await t.test('Manager receives 403 when requesting history', async () => {
      const res = await req('GET', `/history?table=children&id=${childId}`, managerToken);
      assert.equal(res.status, 403);
    });

    await t.test('Admin retrieves history successfully and sees correct actor_user_id', async () => {
      const res = await req('GET', `/history?table=children&id=${childId}`, adminToken);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 2);

      const insertEntry = res.body.data.find((e) => e.operation === 'INSERT');
      const updateEntry = res.body.data.find((e) => e.operation === 'UPDATE');

      assert.ok(insertEntry);
      assert.ok(updateEntry);
      assert.equal(insertEntry.actor_user_id, adminUser.id);
      assert.equal(updateEntry.actor_user_id, adminUser.id);
    });

    await t.test('Admin retrieves state snapshot at timestamp', async () => {
      const at = new Date().toISOString();
      const res = await req('GET', `/history/state?table=children&id=${childId}&at=${encodeURIComponent(at)}`, adminToken);
      assert.equal(res.status, 200);
      assert.ok(res.body.data);
      assert.equal(res.body.data.first_name, 'AuditTest');
    });

    await t.test('Invalid table name returns 400 Bad Request', async () => {
      const res = await req('GET', `/history?table=invalid;table&id=${childId}`, adminToken);
      assert.equal(res.status, 400);
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (db) {
      await db.end().catch(() => {});
    }
    if (connected) {
      if (created) {
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      }
      await admin.end().catch(() => {});
    }
  }
});

