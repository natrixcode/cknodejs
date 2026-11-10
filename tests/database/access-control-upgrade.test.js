import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const migrationDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url)
);

const migrateCli = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test(
  'Access control migrations upgrade existing database',
  {
    skip: !process.env.MIGRATION_TEST_ADMIN_DB,
    timeout: 120000
  },
  async () => {
    const databaseName =
      `cknodejs_access_upgrade_test_${randomUUID().replaceAll('-', '')}`;

    const directory = await mkdtemp(
      join(tmpdir(), 'cknodejs-access-upgrade-')
    );

    const admin = new Client({
      database: process.env.MIGRATION_TEST_ADMIN_DB
    });

    let connected = false;
    let created = false;

    try {
      const migrationFiles = (await readdir(migrationDirectory))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name))
        .sort();

      const copyMigrations = async (from, to) => {
        for (const name of migrationFiles) {
          const number = Number(name.slice(0, 4));

          if (number >= from && number <= to) {
            await copyFile(
              join(migrationDirectory, name),
              join(directory, name)
            );
          }
        }
      };

      const migrate = async () => {
        await execFileAsync(
          process.execPath,
          [migrateCli, '--directory', directory],
          {
            env: {
              ...process.env,
              PGDATABASE: databaseName
            },
            timeout: 30000
          }
        );
      };

      await admin.connect();
      connected = true;

      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;

      await copyMigrations(1, 18);
      await migrate();

      const client = new Client({
        database: databaseName
      });

      await client.connect();

      try {
        const employee = await client.query(
          `INSERT INTO employees
           (first_name, last_name, phone, position, salary)
           VALUES ('Legacy', 'Teacher', '9900001', 'teacher', 0)
           RETURNING id`
        );

        const employeeId = employee.rows[0].id;

        await client.query(
          `INSERT INTO users
           (username, password_hash, role, employee_id)
           VALUES
             ('legacy_teacher', 'test-hash', 'teacher', $1),
             ('legacy_user', 'test-hash', 'user', NULL),
             ('legacy_moderator', 'test-hash', 'moderator', NULL)`,
          [employeeId]
        );

        const before = await client.query(
          `SELECT username, role, employee_id
           FROM users
           WHERE username LIKE 'legacy_%'
           ORDER BY username`
        );

        assert.equal(before.rows.length, 3);

        assert.equal(
          before.rows.find((user) => user.username === 'legacy_teacher').role,
          'teacher'
        );

        console.log('PASS: Existing database contains legacy roles');
      } finally {
        await client.end();
      }

      await copyMigrations(19, 26);
      await migrate();

      const upgraded = new Client({
        database: databaseName
      });

      await upgraded.connect();

      try {
        const result = await upgraded.query(
          `SELECT username, role, employee_id
           FROM users
           WHERE username LIKE 'legacy_%'
           ORDER BY username`
        );

        assert.equal(result.rows.length, 3);

        const teacher = result.rows.find(
          (user) => user.username === 'legacy_teacher'
        );

        const user = result.rows.find(
          (record) => record.username === 'legacy_user'
        );

        const moderator = result.rows.find(
          (record) => record.username === 'legacy_moderator'
        );

        assert.equal(teacher.role, 'employee');
        assert.ok(teacher.employee_id);

        assert.equal(user.role, 'user');
        assert.equal(moderator.role, 'moderator');

        console.log('PASS: Legacy teacher converted to employee');
        console.log('PASS: Existing user and moderator preserved');

        for (const role of ['teacher', 'user', 'moderator']) {
          await assert.rejects(
            upgraded.query(
              `INSERT INTO users
               (username, password_hash, role)
               VALUES ($1, 'test-hash', $2)`,
              [`new_${role}`, role]
            ),
            (error) => error.code === '23514'
          );
        }

        console.log('PASS: New deprecated roles are rejected');

        for (const role of ['teacher', 'user', 'moderator']) {
          await assert.rejects(
            upgraded.query(
              `UPDATE users
               SET role = $1
               WHERE username = 'legacy_teacher'`,
              [role]
            ),
            (error) => error.code === '23514'
          );
        }

        console.log('PASS: Deprecated role assignment is rejected');

        await upgraded.query(
          `UPDATE users
           SET name = 'Existing User Updated'
           WHERE username = 'legacy_user'`
        );

        const updated = await upgraded.query(
          `SELECT name
           FROM users
           WHERE username = 'legacy_user'`
        );

        assert.equal(
          updated.rows[0].name,
          'Existing User Updated'
        );

        console.log('PASS: Existing legacy account remains editable');
      } finally {
        await upgraded.end();
      }

      await migrate();

      console.log('PASS: Repeated migration run is idempotent');
    } finally {
      if (created && connected) {
        await admin.query(
          `DROP DATABASE "${databaseName}" WITH (FORCE)`
        );
      }

      if (connected) {
        await admin.end();
      }

      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  }
);
