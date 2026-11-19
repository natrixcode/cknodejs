import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

// Issue #73: schedule list filtered by teacher_id and room_id.

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

const worker = fileURLToPath(
  new URL('./schedule-filter.worker.js', import.meta.url)
);

test('Schedule list filters by teacher and room (Issue #73)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB',
  timeout: 120000
}, async () => {
  const dbName =
    `cknodejs_schedule_filter_test_${randomUUID().replaceAll('-', '')}`;

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

    const env = { ...process.env, PGDATABASE: dbName };

    await execFileAsync(process.execPath, [migrate], { env, timeout: 30000 });

    const result = await execFileAsync(process.execPath, [worker], {
      env,
      timeout: 60000
    });

    const expected = [
      'Admin lists all lessons',
      'Admin filters by teacher',
      'Admin filters by room',
      'Admin filters by teacher and room',
      'Manager filters by any teacher',
      'Unknown teacher returns empty list',
      'Teacher sees own lessons',
      'Teacher filters by own teacher_id',
      'Teacher filters own lessons by room',
      'Teacher cannot request another teacher',
      'Educator sees own group only',
      'Educator filter stays within own group',
      'Assistant cannot list schedule',
      'Parent cannot list schedule',
      'Invalid teacher_id returns 400',
      'Unknown query parameter returns 400',
      'Unauthenticated request is rejected'
    ];

    for (const name of expected) {
      assert.ok(
        result.stdout.includes(`PASS: ${name}\n`) ||
          result.stdout.includes(`PASS: ${name}\r\n`),
        `Missing result: ${name}\n${result.stdout}\n${result.stderr}`
      );
    }
  } finally {
    try {
      if (created) {
        await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      }
    } finally {
      if (connected) {
        await admin.end();
      }
    }
  }
});
