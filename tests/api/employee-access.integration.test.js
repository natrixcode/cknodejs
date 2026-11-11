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
  new URL('./employee-access.worker.js', import.meta.url)
);

test(
  'Employee API access control',
  {
    skip: !process.env.MIGRATION_TEST_ADMIN_DB,
    timeout: 120000
  },
  async () => {
    const dbName =
      `cknodejs_employee_access_test_${randomUUID().replaceAll('-', '')}`;

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

      assert.match(result.stdout, /PASS: Assistant cannot access protected APIs/);
      assert.match(result.stdout, /PASS: Cook cannot access protected APIs/);
      assert.match(result.stdout, /PASS: Assistant can access health/);
      assert.match(result.stdout, /PASS: Cook can access health/);
      assert.match(result.stdout, /PASS: Admin can access children/);
      assert.match(result.stdout, /PASS: Unauthenticated request is rejected/);
      assert.match(result.stdout, /PASS: Educator sees only own group children/);
      assert.match(result.stdout, /PASS: Educator cannot view another group child/);
      assert.match(result.stdout, /PASS: Teacher sees only permitted child fields/);
      assert.match(result.stdout, /PASS: Teacher cannot update child/);
      assert.match(result.stdout, /PASS: Teacher can view permitted child details/);
      assert.match(result.stdout, /PASS: Teacher cannot view another group child/);
      assert.match(result.stdout, /PASS: Second admin creation is rejected/);
      assert.match(result.stdout, /PASS: Regular manager creation succeeds/);
      assert.match(result.stdout, /PASS: Promoting manager to admin is rejected/);
      assert.match(result.stdout, /PASS: Changing admin role is rejected/);
      assert.match(result.stdout, /PASS: Blocking admin is rejected/);
      assert.match(result.stdout, /PASS: Blocking regular manager succeeds/);
      assert.match(result.stdout, /PASS: Deleting admin through SQL is rejected/);
      assert.match(result.stdout, /PASS: Deactivating admin through SQL is rejected/);
      assert.match(result.stdout, /PASS: Educator can view own group children/);
      assert.match(result.stdout, /PASS: Educator cannot view another group children/);
      assert.match(result.stdout, /PASS: Teacher can view own group limited child fields/);
      assert.match(result.stdout, /PASS: Teacher cannot view another group children/);
      assert.match(result.stdout, /PASS: Teacher cannot modify group children/);
      assert.match(result.stdout, /PASS: Educator can view own group schedule/);
      assert.match(result.stdout, /PASS: Educator cannot view another group schedule/);
      assert.match(result.stdout, /PASS: Teacher can view only own group lessons/);
      assert.match(result.stdout, /PASS: Teacher cannot view another group schedule/);
      assert.match(result.stdout, /PASS: Assistant cannot view group schedule/);
      assert.match(result.stdout, /PASS: Finance access rules for invoices/);
      assert.match(result.stdout, /PASS: Finance access rules for payments/);
      assert.match(result.stdout, /PASS: SQL employee API access rules/);
      assert.match(result.stdout, /PASS: SQL rejects deprecated roles on insert/);
      assert.match(result.stdout, /PASS: SQL rejects deprecated roles on update/);
      assert.match(result.stdout, /PASS: SQL denies inactive employee/);
      assert.match(result.stdout, /PASS: SQL denies blocked user/);
      assert.match(result.stdout, /PASS: SQL denies unknown user/);
    } finally {
      if (created) {
        await admin.query(
          `DROP DATABASE "${dbName}" WITH (FORCE)`
        );
      }

      if (connected) {
        await admin.end();
      }
    }
  }
);
