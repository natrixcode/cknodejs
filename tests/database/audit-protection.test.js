
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

test('Audit log protection and history access SQL logic (Issue #55)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_audit_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let db;
  let created = false;
  let connected = false;
  let testUserId;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: {
        ...process.env,
        PGDATABASE: dbName,
      },
      timeout: 30000,
    });

    db = new Client({ database: dbName });
    await db.connect();

    // 1. Audit log immutability
    await t.test(
      'kms_audit_log is immutable: DELETE, UPDATE, and TRUNCATE are forbidden',
      async () => {
        await db.query(
          `INSERT INTO rooms (name, capacity)
           VALUES ('Room_Audit_1', 10)`
        );

        const logRow = await db.query(
          `SELECT id
           FROM kms_audit_log
           WHERE table_name = 'rooms'
           LIMIT 1`
        );

        assert.ok(logRow.rows.length > 0);

        const auditId = logRow.rows[0].id;

        await assert.rejects(
          db.query(
            `DELETE FROM kms_audit_log WHERE id = $1`,
            [auditId]
          ),
          /KMS_AUDIT_IMMUTABLE/
        );

        await assert.rejects(
          db.query(
            `UPDATE kms_audit_log
             SET table_name = 'hacked'
             WHERE id = $1`,
            [auditId]
          ),
          /KMS_AUDIT_IMMUTABLE/
        );

        await assert.rejects(
          db.query(`TRUNCATE TABLE kms_audit_log`),
          /KMS_AUDIT_IMMUTABLE/
        );
      }
    );

    // 2. Business table TRUNCATE protection
    await t.test(
      'TRUNCATE on business tables is forbidden to prevent audit bypass',
      async () => {
        await assert.rejects(
          db.query(`TRUNCATE TABLE children CASCADE`),
          /KMS_TRUNCATE_FORBIDDEN/
        );

        await assert.rejects(
          db.query(`TRUNCATE TABLE users CASCADE`),
          /KMS_TRUNCATE_FORBIDDEN/
        );
      }
    );

    // 3. Sensitive password masking
    await t.test(
      'users password_hash is masked in audit log',
      async () => {
        const username = `user_${randomUUID().slice(0, 8)}`;
        const rawHash = 'super-secret-password-hash';

        const userRes = await db.query(
          `INSERT INTO users (
             username,
             name,
             email,
             password_hash,
             role
           )
           VALUES ($1, 'Test User', $2, $3, 'admin')
           RETURNING id`,
          [
            username,
            `${username}@test.local`,
            rawHash,
          ]
        );

        const userId = userRes.rows[0].id;

        // Save user ID for the next test
        testUserId = userId;

        const insertAudit = await db.query(
          `SELECT old_data, new_data
           FROM kms_audit_log
           WHERE table_name = 'users'
             AND record_key = $1
             AND operation = 'INSERT'`,
          [String(userId)]
        );

        assert.ok(insertAudit.rows.length > 0);

        assert.equal(
          insertAudit.rows[0].new_data.password_hash,
          '***'
        );

        assert.notEqual(
          insertAudit.rows[0].new_data.password_hash,
          rawHash
        );

        await db.query(
          `UPDATE users
           SET password_hash = 'another-secret-hash'
           WHERE id = $1`,
          [userId]
        );

        const updateAudit = await db.query(
          `SELECT old_data, new_data
           FROM kms_audit_log
           WHERE table_name = 'users'
             AND record_key = $1
             AND operation = 'UPDATE'`,
          [String(userId)]
        );

        assert.ok(updateAudit.rows.length > 0);

        assert.equal(
          updateAudit.rows[0].old_data.password_hash,
          '***'
        );

        assert.equal(
          updateAudit.rows[0].new_data.password_hash,
          '***'
        );
      }
    );

    // 4. Actor user ID
    await t.test(
      'kms.actor_user_id is recorded in audit entry when set',
      async () => {
        assert.ok(testUserId, 'Test user must exist');

        let roomId;

        await db.query('BEGIN');

        try {
          await db.query(
            `SELECT set_config('kms.actor_user_id', $1, true)`,
            [String(testUserId)]
          );

          const roomName = `Room_${randomUUID().slice(0, 8)}`;

          const res = await db.query(
            `INSERT INTO rooms (name, capacity)
             VALUES ($1, 15)
             RETURNING id`,
            [roomName]
          );

          roomId = res.rows[0].id;

          await db.query('COMMIT');
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }

        const auditRow = await db.query(
          `SELECT actor_user_id
           FROM kms_audit_log
           WHERE table_name = 'rooms'
             AND record_key = $1
             AND operation = 'INSERT'`,
          [String(roomId)]
        );

        assert.ok(auditRow.rows.length > 0);

        assert.equal(
          Number(auditRow.rows[0].actor_user_id),
          Number(testUserId)
        );
      }
    );

    // 5. Record history
    await t.test(
      'kms_get_record_history returns change history',
      async () => {
        const roomName = `Room_History_${randomUUID().slice(0, 8)}`;

        const res = await db.query(
          `INSERT INTO rooms (name, capacity)
           VALUES ($1, 20)
           RETURNING id`,
          [roomName]
        );

        const roomId = res.rows[0].id;

        await db.query(
          `UPDATE rooms
           SET capacity = 25
           WHERE id = $1`,
          [roomId]
        );

        const history = await db.query(
          `SELECT *
           FROM kms_get_record_history('rooms', $1)`,
          [String(roomId)]
        );

        assert.equal(history.rows.length, 2);
        assert.equal(history.rows[0].operation, 'INSERT');
        assert.equal(history.rows[1].operation, 'UPDATE');
      }
    );

    // 6. Historical state reconstruction
    await t.test(
      'kms_get_record_state_at reconstructs snapshot at timestamp',
      async () => {
        const roomName = `Room_Snapshot_${randomUUID().slice(0, 8)}`;

        const res = await db.query(
          `INSERT INTO rooms (name, capacity)
           VALUES ($1, 10)
           RETURNING id`,
          [roomName]
        );

        const roomId = res.rows[0].id;

        const afterInsertTs = (
          await db.query(
            `SELECT clock_timestamp() AS ts`
          )
        ).rows[0].ts;

        await new Promise((resolve) => setTimeout(resolve, 50));

        await db.query(
          `UPDATE rooms
           SET capacity = 30
           WHERE id = $1`,
          [roomId]
        );

        const stateBefore = await db.query(
          `SELECT kms_get_record_state_at(
             'rooms',
             $1,
             $2::timestamptz
           ) AS state`,
          [String(roomId), afterInsertTs]
        );

        assert.equal(
          stateBefore.rows[0].state.capacity,
          10
        );

        const stateNow = await db.query(
          `SELECT kms_get_record_state_at(
             'rooms',
             $1,
             clock_timestamp()
           ) AS state`,
          [String(roomId)]
        );

        assert.equal(
          stateNow.rows[0].state.capacity,
          30
        );
      }
    );

  } finally {
    if (db) {
      await db.end().catch(() => {});
    }

    if (connected) {
      if (created) {
        await admin.query(
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`
        ).catch(() => {});
      }

      await admin.end().catch(() => {});
    }
  }
});
