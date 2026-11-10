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

test('Children archive HTTP API integration (Issue #52)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_api_archive_test_${randomUUID().replaceAll('-', '')}`;

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

    // Create test parent record for parent user
    const parentRow = await db.query(
      `INSERT INTO parents (first_name, last_name, phone, email)
       VALUES ('Parent', 'User', '+380509999001', 'parent_user@test.local')
       RETURNING id`
    );
    const parentId = parentRow.rows[0].id;

    // Create Admin, Manager, and Parent users
    const users = await db.query(
      `INSERT INTO users (username, password_hash, role, parent_id)
       VALUES
         ('test_arch_admin', 'hash', 'admin', NULL),
         ('test_arch_manager', 'hash', 'manager', NULL),
         ('test_arch_parent', 'hash', 'parent', $1)
       RETURNING id, role`,
      [parentId]
    );

    const adminUser = users.rows.find((u) => u.role === 'admin');
    const managerUser = users.rows.find((u) => u.role === 'manager');
    const parentUser = users.rows.find((u) => u.role === 'parent');

    const adminToken = createSession(adminUser.id).token;
    const managerToken = createSession(managerUser.id).token;
    const parentToken = createSession(parentUser.id).token;

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

    // Helper: create active child
    async function createChild(name) {
      const res = await req('POST', '/children', adminToken, {
        first_name: name,
        last_name: 'ArchiveTest',
        date_of_birth: '2023-01-15',
      });
      assert.equal(res.status, 201);
      return res.body.data.id;
    }

    const childId = await createChild('John');

    await t.test('Parent role receives 403 on archive attempt', async () => {
      const res = await req('POST', `/children/${childId}/archive`, parentToken, {
        reason: 'Parent attempt',
      });
      assert.equal(res.status, 403);
    });

    await t.test('Manager archives child successfully returns 200', async () => {
      const res = await req('POST', `/children/${childId}/archive`, managerToken, {
        reason: 'Child left kindergarten',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'archived');
      assert.equal(res.body.data.archive_reason, 'Child left kindergarten');
    });

    await t.test('Repeat archive attempt returns 409 Conflict', async () => {
      const res = await req('POST', `/children/${childId}/archive`, managerToken, {
        reason: 'Duplicate archive attempt',
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.message, 'KMS_CHILD_ALREADY_ARCHIVED');
    });

    await t.test('GET /children excludes archived child by default', async () => {
      const res = await req('GET', '/children', managerToken);
      assert.equal(res.status, 200);
      const found = res.body.data.some((c) => c.id === childId);
      assert.equal(found, false, 'Archived child should not appear in default list');
    });

    await t.test('GET /children?archived=true returns archived child', async () => {
      const res = await req('GET', '/children?archived=true', managerToken);
      assert.equal(res.status, 200);
      const found = res.body.data.some((c) => c.id === childId);
      assert.equal(found, true, 'Archived child should appear in archived list');
    });

    await t.test('Manager receives 403 when attempting to unarchive', async () => {
      const res = await req('POST', `/children/${childId}/unarchive`, managerToken);
      assert.equal(res.status, 403);
    });

    await t.test('Issuing new invoice to archived child returns 409 Conflict', async () => {
      const res = await req('POST', '/invoices', adminToken, {
        child_id: childId,
        period_start: '2026-11-01',
        months: 1,
        meal_days: 10,
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.message, 'KMS_CHILD_ARCHIVED');
    });

    await t.test('Admin unarchives child successfully returns 200', async () => {
      const res = await req('POST', `/children/${childId}/unarchive`, adminToken);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'active');
      assert.equal(res.body.data.archived_at, null);
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

