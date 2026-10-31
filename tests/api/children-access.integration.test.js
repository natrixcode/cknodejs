
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
  new URL('./children-access.worker.js', import.meta.url)
);

test('Children API access control', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
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

    assert.match(result.stdout, /PASS: Admin can view child/);
    assert.match(result.stdout, /PASS: Parent A can view own child/);
    assert.match(result.stdout, /PASS: Parent B cannot view unrelated child/);
    assert.match(result.stdout, /PASS: Parent A cannot update child/);
    assert.match(result.stdout, /PASS: Parent A cannot list all children/);
    assert.match(result.stdout, /PASS: Admin can view invoice/);
    assert.match(result.stdout, /PASS: Parent A can view own invoice/);
    assert.match(result.stdout, /PASS: Parent B cannot view unrelated invoice/);
    assert.match(result.stdout, /PASS: Parent A can view own payment/);
    assert.match(result.stdout, /PASS: Parent B cannot view unrelated payment/);
    assert.match(result.stdout, /PASS: Parent A cannot create invoice/);
    assert.match(result.stdout, /PASS: Parent A cannot create payment/);

  } finally {
    if (created) {
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    }

    if (connected) {
      await admin.end();
    }
  }
});
