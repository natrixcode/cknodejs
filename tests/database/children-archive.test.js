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

test('Children archive SQL business logic (Issue #52)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_archive_test_${randomUUID().replaceAll('-', '')}`;
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

    async function createTestRoomAndGroup() {
      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 20) RETURNING id`,
        [`Room_${randomUUID().slice(0, 8)}`]
      );
      const group = await db.query(
        `INSERT INTO groups (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 20) RETURNING id`,
        [`Group_${randomUUID().slice(0, 8)}`, room.rows[0].id]
      );
      return { roomId: room.rows[0].id, groupId: group.rows[0].id };
    }

    async function createTestChild(groupId = null) {
      const res = await db.query(
        `INSERT INTO children (first_name, last_name, date_of_birth, group_id)
         VALUES ('Test', 'Child', CURRENT_DATE - INTERVAL '3 years', $1)
         RETURNING id`,
        [groupId]
      );
      return res.rows[0].id;
    }

    async function createTestParent(phoneSuffix) {
      const res = await db.query(
        `INSERT INTO parents (first_name, last_name, phone, email)
         VALUES ('Parent', 'Test', $1, $2)
         RETURNING id`,
        [`+38050${phoneSuffix}`, `parent_${phoneSuffix}@test.local`]
      );
      return res.rows[0].id;
    }

    await t.test('Archive child removes from group and sets status to archived', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const childId = await createTestChild(groupId);

      const archived = await db.query(
        `SELECT * FROM kms_archive_child($1, $2)`,
        [childId, 'Family relocation']
      );

      assert.equal(archived.rows[0].status, 'archived');
      assert.equal(archived.rows[0].group_id, null);
      assert.equal(archived.rows[0].archive_reason, 'Family relocation');
      assert.ok(archived.rows[0].archived_at);

      // Verify in database
      const row = await db.query('SELECT * FROM children WHERE id = $1', [childId]);
      assert.equal(row.rows[0].status, 'archived');
      assert.equal(row.rows[0].group_id, null);
    });

    await t.test('Auto-archive parents when all their children are archived', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const parent1 = await createTestParent('1110001');
      const parent2 = await createTestParent('1110002');

      const childA = await createTestChild(groupId);
      const childB = await createTestChild(groupId);

      // parent1 has only childA
      await db.query(
        `INSERT INTO children_parents (child_id, parent_id) VALUES ($1, $2)`,
        [childA, parent1]
      );

      // parent2 has childA and childB
      await db.query(
        `INSERT INTO children_parents (child_id, parent_id) VALUES ($1, $2), ($3, $2)`,
        [childA, parent2, childB]
      );

      // Archive childA
      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [childA, 'Child A leave']);

      // parent1 should be archived (no active children left)
      const p1 = await db.query('SELECT * FROM parents WHERE id = $1', [parent1]);
      assert.equal(p1.rows[0].status, 'archived');
      assert.ok(p1.rows[0].archived_at);

      // parent2 should remain active (childB is still active)
      const p2 = await db.query('SELECT * FROM parents WHERE id = $1', [parent2]);
      assert.equal(p2.rows[0].status, 'active');
      assert.equal(p2.rows[0].archived_at, null);

      // Archive childB
      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [childB, 'Child B leave']);

      // parent2 should now be archived as well
      const p2After = await db.query('SELECT * FROM parents WHERE id = $1', [parent2]);
      assert.equal(p2After.rows[0].status, 'archived');
    });

    await t.test('Unarchive child restores child and parent to active status', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const parent = await createTestParent('1110003');
      const child = await createTestChild(groupId);

      await db.query(
        `INSERT INTO children_parents (child_id, parent_id) VALUES ($1, $2)`,
        [child, parent]
      );

      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [child, 'Leave']);

      const unarchived = await db.query(`SELECT * FROM kms_unarchive_child($1)`, [child]);
      assert.equal(unarchived.rows[0].status, 'active');
      assert.equal(unarchived.rows[0].archived_at, null);
      assert.equal(unarchived.rows[0].archive_reason, null);

      const p = await db.query('SELECT * FROM parents WHERE id = $1', [parent]);
      assert.equal(p.rows[0].status, 'active');
      assert.equal(p.rows[0].archived_at, null);
    });

    await t.test('Cannot assign group to an archived child', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const child = await createTestChild();

      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [child, 'Leave']);

      await assert.rejects(
        db.query(`UPDATE children SET group_id = $1 WHERE id = $2`, [groupId, child]),
        /KMS_CANNOT_ASSIGN_ARCHIVED_CHILD/
      );
    });

    await t.test('Cannot issue new invoice to an archived child', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const child = await createTestChild(groupId);

      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [child, 'Leave']);

      await assert.rejects(
        db.query(`SELECT * FROM kms_issue_invoice($1, $2::date, 1, 5)`, [child, '2026-11-01']),
        /KMS_CHILD_ARCHIVED/
      );
    });

    await t.test('Can pay existing issued invoice for an archived child (debt settlement)', async () => {
      const { groupId } = await createTestRoomAndGroup();
      const child = await createTestChild(groupId);

      // Issue invoice while active
      const inv = await db.query(
        `SELECT * FROM kms_issue_invoice($1, $2::date, 1, 5)`,
        [child, '2026-11-01']
      );
      const invoiceId = inv.rows[0].id;

      // Archive child
      await db.query(`SELECT * FROM kms_archive_child($1, $2)`, [child, 'Leave']);

      // Paying invoice must succeed
      const payment = await db.query(
        `SELECT * FROM kms_register_payment($1, $2, 'card', $3)`,
        [invoiceId, inv.rows[0].total_amount, `tx_archive_${randomUUID().slice(0, 8)}`]
      );
      assert.equal(payment.rows[0].invoice_id, invoiceId);

      const paidInv = await db.query('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
      assert.equal(paidInv.rows[0].status, 'paid');
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

