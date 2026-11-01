
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test('Children HTTP + PostgreSQL integration', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_api_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let db;
  let appPool;
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

    // PGDATABASE має бути задано до імпорту app.js.
    process.env.PGDATABASE = dbName;

   const { default: app } = await import('../../src/app.js');
   const { pool } = await import('../../src/config/database.js');
   appPool = pool;

     // Окреме підключення для перевірки даних у PostgreSQL
    db = new Client({ database: dbName });
    await db.connect();

    server = app.listen(0);

    await new Promise((resolve) => {
      server.once('listening', resolve);
    });

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    async function post(path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      return {
        status: response.status,
        body: await response.json(),
      };
    }

    function birthDate(years) {
      const date = new Date();
      date.setUTCFullYear(date.getUTCFullYear() - years);
      return date.toISOString().slice(0, 10);
    }

    async function createChild(suffix, years = 3) {
      return post('/children', {
        first_name: 'Test',
        last_name: suffix,
        date_of_birth: birthDate(years),
      });
    }

    await t.test('Child younger than 2 returns 400', async () => {
      const result = await createChild('TooYoung', 1);

      assert.equal(result.status, 400);
      assert.equal(
        result.body.message,
        'KMS_CHILD_AGE_OUT_OF_RANGE'
      );
    });

    await t.test('Child aged 6 returns 400', async () => {
      const result = await createChild('TooOld', 6);

      assert.equal(result.status, 400);
      assert.equal(
        result.body.message,
        'KMS_CHILD_AGE_OUT_OF_RANGE'
      );
    });

    await t.test('Valid child returns 201 and persists', async () => {
      const result = await createChild('Valid', 3);

      assert.equal(result.status, 201);

      const childId = result.body.data.id;
      assert.ok(childId);

      const saved = await db.query(
        'SELECT id FROM children WHERE id = $1',
        [childId]
      );

      assert.equal(saved.rowCount, 1);
    });

    await t.test('Full group returns 409 without over-enrollment', async () => {
      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, $2) RETURNING id`,
        ['API Test Room', 1]
      );

      const group = await db.query(
        `INSERT INTO groups
           (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['API Test Group', room.rows[0].id, 3, 1]
      );

      const groupId = group.rows[0].id;

      const first = await createChild('First', 3);
      const second = await createChild('Second', 3);

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);

      const firstEnrollment = await post(
        `/groups/${groupId}/children`,
        { child_id: first.body.data.id }
      );

      assert.equal(firstEnrollment.status, 200);

      const secondEnrollment = await post(
        `/groups/${groupId}/children`,
        { child_id: second.body.data.id }
      );

      assert.equal(secondEnrollment.status, 409);
      assert.equal(
        secondEnrollment.body.message,
        'KMS_GROUP_FULL'
      );

      const count = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM children WHERE group_id = $1`,
        [groupId]
      );

      assert.equal(count.rows[0].total, 1);
    });
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error ? reject(error) : resolve()
        );
      });
    }

    await appPool?.end();
    await db?.end();

    if (created && connected) {
      await admin.query(
        `DROP DATABASE "${dbName}" WITH (FORCE)`
      );
    }

    if (connected) {
      await admin.end();
    }
  }
});
