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

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    db = new Client({ database: dbName });
    await db.connect();

    await t.test('kms_audit_log is immutable: DELETE, UPDATE, and TRUNCATE are forbidden', async () => {
      // Insert a test record to generate an audit log entry
      await db.query(
        `INSERT INTO rooms (name, capacity) VALUES ('Room_Audit_1', 10)`
      );

      const logRow = await db.query(
        `SELECT id FROM kms_audit_log WHERE table_name = 'rooms' LIMIT 1`
      );
      assert.ok(logRow.rows.length > 0);
      const auditId = logRow.rows[0].id;

      // DELETE must throw KMS_AUDIT_IMMUTABLE
      await assert.rejects(
        db.query(`DELETE FROM kms_audit_log WHERE id = $1`, [auditId]),
        /KMS_AUDIT_IMMUTABLE/
      );

      // UPDATE must throw KMS_AUDIT_IMMUTABLE
      await assert.rejects(
        db.query(`UPDATE kms_audit_log SET table_name = 'hacked' WHERE id = $1`, [auditId]),
        /KMS_AUDIT_IMMUTABLE/
      );

      // TRUNCATE must throw KMS_AUDIT_IMMUTABLE
      await assert.rejects(
        db.query(`TRUNCATE TABLE kms_audit_log`),
        /KMS_AUDIT_IMMUTABLE/
      );
    });

    await t.test('TRUNCATE on business tables is forbidden to prevent audit bypass', async () => {
      await assert.rejects(
        db.query(`TRUNCATE TABLE children`),
        /KMS_TRUNCATE_FORBIDDEN/
      );

      await assert.rejects(
        db.query(`TRUNCATE TABLE users`),
        /KMS_TRUNCATE_FORBIDDEN/
      );
    });

    await t.test('users password_hash is masked in audit log', async () => {
      const username = `user_${randomUUID().slice(0, 8)}`;
      const rawHash = 'super-secret-password-hash';

      const userRes = await db.query(
        `INSERT INTO users (username, name, email, password_hash, role)
         VALUES ($1, 'Test User', $2, $3, 'admin')
         RETURNING id`,
        [username, `${username}@test.local`, rawHash]
      );
      const userId = userRes.rows[0].id;

      // Check the INSERT audit entry
      const insertAudit = await db.query(
        `SELECT old_data, new_data FROM kms_audit_log
         WHERE table_name = 'users' AND record_key = $1 AND operation = 'INSERT'`,
        [String(userId)]
      );
      assert.ok(insertAudit.rows.length > 0);
      assert.equal(insertAudit.rows[0].new_data.password_hash, '***');
      assert.notEqual(insertAudit.rows[0].new_data.password_hash, rawHash);

      // Update user password and check UPDATE audit entry
      await db.query(
        `UPDATE users SET password_hash = 'another-secret-hash' WHERE id = $1`,
        [userId]
      );

      const updateAudit = await db.query(
        `SELECT old_data, new_data FROM kms_audit_log
         WHERE table_name = 'users' AND record_key = $1 AND operation = 'UPDATE'`,
        [String(userId)]
      );
      assert.ok(updateAudit.rows.length > 0);
      assert.equal(updateAudit.rows[0].old_data.password_hash, '***');
      assert.equal(updateAudit.rows[0].new_data.password_hash, '***');
    });

    await t.test('kms.actor_user_id is recorded in audit entry when set', async () => {
      await db.query('BEGIN');
      await db.query("SELECT set_config('kms.actor_user_id', '999', true)");

      const roomName = `Room_${randomUUID().slice(0, 8)}`;
      const res = await db.query(
        `INSERT INTO rooms (name, capacity) VALUES ($1, 15) RETURNING id`,
        [roomName]
      );
      const roomId = res.rows[0].id;

      await db.query('COMMIT');

      const auditRow = await db.query(
        `SELECT actor_user_id FROM kms_audit_log
         WHERE table_name = 'rooms' AND record_key = $1 AND operation = 'INSERT'`,
        [String(roomId)]
      );
      assert.ok(auditRow.rows.length > 0);
      assert.equal(auditRow.rows[0].actor_user_id, 999);
    });

    await t.test('kms_get_record_history returns change history', async () => {
      const roomName = `Room_History_${randomUUID().slice(0, 8)}`;
      const res = await db.query(
        `INSERT INTO rooms (name, capacity) VALUES ($1, 20) RETURNING id`,
        [roomName]
      );
      const roomId = res.rows[0].id;

      await db.query(
        `UPDATE rooms SET capacity = 25 WHERE id = $1`,
        [roomId]
      );

      const history = await db.query(
        `SELECT * FROM kms_get_record_history('rooms', $1)`,
        [String(roomId)]
      );

      assert.equal(history.rows.length, 2);
      assert.equal(history.rows[0].operation, 'INSERT');
      assert.equal(history.rows[1].operation, 'UPDATE');
    });

    await t.test('kms_get_record_state_at reconstructs snapshot at timestamp', async () => {
      const roomName = `Room_Snapshot_${randomUUID().slice(0, 8)}`;
      const res = await db.query(
        `INSERT INTO rooms (name, capacity) VALUES ($1, 10) RETURNING id`,
        [roomName]
      );
      const roomId = res.rows[0].id;

      // Get timestamp right after INSERT
      const afterInsertTs = (await db.query('SELECT clock_timestamp() AS ts')).rows[0].ts;

      // Wait a tiny bit and perform UPDATE
      await new Promise((r) => setTimeout(r, 50));
      await db.query(`UPDATE rooms SET capacity = 30 WHERE id = $1`, [roomId]);

      // Query state at afterInsertTs -> should have capacity 10
      const stateBefore = await db.query(
        `SELECT kms_get_record_state_at('rooms', $1, $2::timestamptz) AS state`,
        [String(roomId), afterInsertTs]
      );
      assert.equal(stateBefore.rows[0].state.capacity, 10);

      // Query state now -> should have capacity 30
      const stateNow = await db.query(
        `SELECT kms_get_record_state_at('rooms', $1, clock_timestamp()) AS state`,
        [String(roomId)]
      );
      assert.equal(stateNow.rows[0].state.capacity, 30);
    });

  } finally {
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

