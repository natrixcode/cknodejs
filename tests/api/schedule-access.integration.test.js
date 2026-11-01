
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

const worker = fileURLToPath(
  new URL('./schedule-access.worker.js', import.meta.url)
);

test('Schedule API access control', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB',
  timeout: 120000
}, async () => {
  const dbName =
    `cknodejs_access_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB
  });

  let connected = false;
  let created = false;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    const env = {
      ...process.env,
      PGDATABASE: dbName
    };

    await execFileAsync(process.execPath, [migrate], {
      env,
      timeout: 30000
    });

    const result = await execFileAsync(process.execPath, [worker], {
      env,
      timeout: 60000
    });

    const expected = [
      'Admin can list schedules',
      'Manager can list schedules',
      'Parent cannot list schedules',
      'Teacher cannot list schedules',
      'Educator cannot list schedules',
      'Assistant cannot list schedules',
      'Admin can view any lesson',
      'Manager can view any lesson',
      'Teacher can view assigned lesson',
      'Teacher cannot view another teacher lesson',
      'Educator can view own group lesson',
      'Educator cannot view another group lesson',
      'Parent can view own published lesson',
      'Parent cannot view another group lesson',
      'Parent cannot view draft lesson',
      'Assistant cannot view lesson',
      'Parent cannot edit lesson',
      'Teacher cannot edit lesson',
      'Manager cannot publish lesson',
      'Unauthenticated request is rejected'
    ];

    for (const name of expected) {
      assert.ok(
        result.stdout.includes(`PASS: ${name}\n`) ||
        result.stdout.includes(`PASS: ${name}\r\n`),
        `Missing result: ${name}\n${result.stdout}`
      );
    }
  } finally {
    try {
      if (created) {
        await admin.query(
          `DROP DATABASE "${dbName}" WITH (FORCE)`
        );
      }
    } finally {
      if (connected) {
        await admin.end();
      }
    }
  }
});
