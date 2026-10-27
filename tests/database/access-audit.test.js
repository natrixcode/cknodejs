
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

test('Access control and audit SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_audit_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });

  let db;
  let connected = false;
  let created = false;
  let counter = 0;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    db = new Client({
      database: dbName,
      connectionTimeoutMillis: 3000,
    });
    await db.connect();

    async function rollback(action) {
      await db.query('BEGIN');
      try {
        await action();
      } finally {
        await db.query('ROLLBACK');
      }
    }

    const scenario = (name, action) =>
      t.test(name, () => rollback(action));

    async function id(sql, params = []) {
      const result = await db.query(sql, params);
      return result.rows[0].id;
    }

    async function createChild(groupId = null) {
      return id(
        `INSERT INTO children
          (first_name, last_name, date_of_birth, group_id)
         VALUES (
           'Audit', 'Child', DATE '2023-05-15', $1
         )
         RETURNING id`,
        [groupId]
      );
    }

    async function createParent() {
      const n = ++counter;

      return id(
        `INSERT INTO parents
          (first_name, last_name, phone)
         VALUES ('Audit', $1, $2)
         RETURNING id`,
        [
          `Parent${n}`,
          `38050${String(n).padStart(7, '0')}`,
        ]
      );
    }

    async function createEmployee(position = 'educator') {
      const n = ++counter;

      return id(
        `INSERT INTO employees
          (first_name, last_name, phone, position, salary)
         VALUES ('Audit', $1, $2, $3, 10000)
         RETURNING id`,
        [
          `Employee${n}`,
          `38067${String(n).padStart(7, '0')}`,
          position,
        ]
      );
    }

    async function createGroup() {
      const n = ++counter;

      const roomId = await id(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 10)
         RETURNING id`,
        [`Audit Room ${n}`]
      );

      return id(
        `INSERT INTO groups
          (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 10)
         RETURNING id`,
        [`Audit Group ${n}`, roomId]
      );
    }

    async function createUser(
      role,
      {
        parentId = null,
        employeeId = null,
        status = 'active',
        isActive = true,
      } = {}
    ) {
      const n = ++counter;

      return id(
        `INSERT INTO users
          (username, password_hash, role,
           parent_id, employee_id, status, is_active)
         VALUES ($1, 'test-hash', $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          `audit_user_${n}`,
          role,
          parentId,
          employeeId,
          status,
          isActive,
        ]
      );
    }

    async function allowed(functionName, userId, resourceId) {
      const functions = new Set([
        'kms_can_view_child',
        'kms_can_view_invoice',
        'kms_can_manage_area',
      ]);

      if (!functions.has(functionName)) {
        throw new Error('Unexpected access-check function');
      }

      const result = await db.query(
        `SELECT ${functionName}($1, $2) AS allowed`,
        [userId, resourceId]
      );

      return result.rows[0].allowed;
    }

    async function makeFixture() {
      const group1 = await createGroup();
      const group2 = await createGroup();

      const child1 = await createChild(group1);
      const child2 = await createChild(group2);

      const parent1 = await createParent();
      const parent2 = await createParent();

      await db.query(
        'SELECT kms_link_parent_to_child($1, $2)',
        [child1, parent1]
      );

      await db.query(
        'SELECT kms_link_parent_to_child($1, $2)',
        [child2, parent2]
      );

      const employee1 = await createEmployee();
      const employee2 = await createEmployee();

      await db.query(
        `SELECT kms_assign_employee_to_group(
          $1, $2, 'educator'
        )`,
        [group1, employee1]
      );

      await db.query(
        `SELECT kms_assign_employee_to_group(
          $1, $2, 'educator'
        )`,
        [group2, employee2]
      );

      const adminUser = await createUser('admin');
      const managerUser = await createUser('manager');

      const parentUser1 = await createUser('parent', {
        parentId: parent1,
      });

      const parentUser2 = await createUser('parent', {
        parentId: parent2,
      });

      const employeeUser1 = await createUser('employee', {
        employeeId: employee1,
      });

      const employeeUser2 = await createUser('employee', {
        employeeId: employee2,
      });

      const regularUser = await createUser('user');

      return {
        group1,
        group2,
        child1,
        child2,
        parent1,
        parent2,
        employee1,
        employee2,
        adminUser,
        managerUser,
        parentUser1,
        parentUser2,
        employeeUser1,
        employeeUser2,
        regularUser,
      };
    }

    async function audit(tableName, recordKey, operation) {
      const result = await db.query(
        `SELECT *
         FROM kms_audit_log
         WHERE table_name = $1
           AND record_key = $2
           AND operation = $3
         ORDER BY id DESC
         LIMIT 1`,
        [tableName, String(recordKey), operation]
      );

      return result.rows[0];
    }

    // ==========================================
    // ACCESS TO CHILDREN
    // ==========================================

    await scenario('1. Admin and manager can view children', async () => {
      const f = await makeFixture();

      for (const user of [f.adminUser, f.managerUser]) {
        assert.equal(
          await allowed('kms_can_view_child', user, f.child1),
          true
        );

        assert.equal(
          await allowed('kms_can_view_child', user, f.child2),
          true
        );
      }
    });

    await scenario('2. Parents can view only their children', async () => {
      const f = await makeFixture();

      assert.equal(
        await allowed(
          'kms_can_view_child', f.parentUser1, f.child1
        ),
        true
      );

      assert.equal(
        await allowed(
          'kms_can_view_child', f.parentUser1, f.child2
        ),
        false
      );

      assert.equal(
        await allowed(
          'kms_can_view_child', f.parentUser2, f.child2
        ),
        true
      );
    });

    await scenario('3. Employees can view only assigned group', async () => {
      const f = await makeFixture();

      assert.equal(
        await allowed(
          'kms_can_view_child', f.employeeUser1, f.child1
        ),
        true
      );

      assert.equal(
        await allowed(
          'kms_can_view_child', f.employeeUser1, f.child2
        ),
        false
      );

      assert.equal(
        await allowed(
          'kms_can_view_child', f.employeeUser2, f.child2
        ),
        true
      );
    });

    await t.test('4. Inactive users cannot view children', async () => {
      for (const status of ['inactive', 'blocked', 'pending']) {
        await rollback(async () => {
          const f = await makeFixture();

          await db.query(
            'UPDATE users SET status = $1 WHERE id = $2',
            [status, f.parentUser1]
          );

          assert.equal(
            await allowed(
              'kms_can_view_child',
              f.parentUser1,
              f.child1
            ),
            false
          );
        });
      }
    });

    await scenario('5. Disabled user cannot view child', async () => {
      const f = await makeFixture();

      await db.query(
        `UPDATE users
         SET is_active = FALSE
         WHERE id = $1`,
        [f.parentUser1]
      );

      assert.equal(
        await allowed(
          'kms_can_view_child',
          f.parentUser1,
          f.child1
        ),
        false
      );
    });

    await scenario('6. Unlinking parent revokes access', async () => {
      const f = await makeFixture();

      assert.equal(
        await allowed(
          'kms_can_view_child',
          f.parentUser1,
          f.child1
        ),
        true
      );

      await db.query(
        'SELECT kms_unlink_parent_from_child($1, $2)',
        [f.child1, f.parent1]
      );

      assert.equal(
        await allowed(
          'kms_can_view_child',
          f.parentUser1,
          f.child1
        ),
        false
      );
    });

    await scenario('7. Removing staff assignment revokes access', async () => {
      const f = await makeFixture();

      await db.query(
        'SELECT kms_remove_employee_from_group($1, $2)',
        [f.group1, f.employee1]
      );

      assert.equal(
        await allowed(
          'kms_can_view_child',
          f.employeeUser1,
          f.child1
        ),
        false
      );
    });

    // ==========================================
    // ACCESS TO INVOICES
    // ==========================================

    await scenario('8. Admin and related parent can view invoice', async () => {
      const f = await makeFixture();

      const invoice = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1, DATE '2026-10-01', 1, 5
         )`,
        [f.child1]
      );

      const invoiceId = invoice.rows[0].id;

      assert.equal(
        await allowed(
          'kms_can_view_invoice',
          f.adminUser,
          invoiceId
        ),
        true
      );

      assert.equal(
        await allowed(
          'kms_can_view_invoice',
          f.parentUser1,
          invoiceId
        ),
        true
      );
    });

    await scenario('9. Unrelated users cannot view invoice', async () => {
      const f = await makeFixture();

      const invoice = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1, DATE '2026-10-01', 1, 5
         )`,
        [f.child1]
      );

      const invoiceId = invoice.rows[0].id;

      for (const user of [
        f.managerUser,
        f.parentUser2,
        f.employeeUser1,
        f.regularUser,
      ]) {
        assert.equal(
          await allowed(
            'kms_can_view_invoice',
            user,
            invoiceId
          ),
          false
        );
      }
    });

    await scenario('10. Blocked parent cannot view invoice', async () => {
      const f = await makeFixture();

      const invoice = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1, DATE '2026-10-01', 1, 5
         )`,
        [f.child1]
      );

      await db.query(
        `UPDATE users
         SET status = 'blocked'
         WHERE id = $1`,
        [f.parentUser1]
      );

      assert.equal(
        await allowed(
          'kms_can_view_invoice',
          f.parentUser1,
          invoice.rows[0].id
        ),
        false
      );
    });

    // ==========================================
    // ADMINISTRATIVE RIGHTS
    // ==========================================

    await scenario('11. Manager has permitted area access', async () => {
      const f = await makeFixture();

      for (const area of [
        'children',
        'parents',
        'groups',
        'rooms',
        'schedule',
      ]) {
        assert.equal(
          await allowed(
            'kms_can_manage_area',
            f.managerUser,
            area
          ),
          true
        );
      }
    });

    await scenario('12. Manager cannot manage financial areas', async () => {
      const f = await makeFixture();

      for (const area of [
        'payments',
        'invoices',
        'salaries',
        'expenses',
      ]) {
        assert.equal(
          await allowed(
            'kms_can_manage_area',
            f.managerUser,
            area
          ),
          false
        );
      }
    });

    await scenario('13. Admin can manage all tested areas', async () => {
      const f = await makeFixture();

      for (const area of [
        'children',
        'groups',
        'payments',
        'salaries',
        'expenses',
      ]) {
        assert.equal(
          await allowed(
            'kms_can_manage_area',
            f.adminUser,
            area
          ),
          true
        );
      }
    });

    await scenario('14. Regular users cannot manage areas', async () => {
      const f = await makeFixture();

      for (const user of [
        f.parentUser1,
        f.employeeUser1,
        f.regularUser,
      ]) {
        assert.equal(
          await allowed(
            'kms_can_manage_area',
            user,
            'children'
          ),
          false
        );
      }
    });

    await scenario('15. Unknown user has no access', async () => {
      const childId = await createChild();

      assert.equal(
        await allowed('kms_can_view_child', -1, childId),
        false
      );

      assert.equal(
        await allowed('kms_can_manage_area', -1, 'children'),
        false
      );

      assert.equal(
        await allowed('kms_can_view_invoice', -1, -1),
        false
      );
    });

    // ==========================================
    // AUDIT LOG
    // ==========================================

    await t.test('16. Audit triggers exist on protected tables', async () => {
      const result = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM pg_trigger
         WHERE tgname = 'trg_kms_audit'
           AND NOT tgisinternal`
      );

      assert.equal(result.rows[0].count, 22);
    });

    await scenario('17. INSERT creates audit entry', async () => {
      const parentId = await createParent();

      const row = await audit(
        'parents',
        parentId,
        'INSERT'
      );

      assert.ok(row);
      assert.equal(row.operation, 'INSERT');
      assert.equal(row.old_data, null);
      assert.equal(row.new_data.first_name, 'Audit');
    });

    await scenario('18. UPDATE records old and new values', async () => {
      const parentId = await createParent();

      await db.query(
        `UPDATE parents
         SET last_name = 'Updated'
         WHERE id = $1`,
        [parentId]
      );

      const row = await audit(
        'parents',
        parentId,
        'UPDATE'
      );

      assert.ok(row);
      assert.notEqual(
        row.old_data.last_name,
        row.new_data.last_name
      );

      assert.equal(
        row.new_data.last_name,
        'Updated'
      );
    });

    await scenario('19. DELETE records old data', async () => {
      const parentId = await createParent();

      await db.query(
        'DELETE FROM parents WHERE id = $1',
        [parentId]
      );

      const row = await audit(
        'parents',
        parentId,
        'DELETE'
      );

      assert.ok(row);
      assert.equal(row.operation, 'DELETE');
      assert.equal(row.new_data, null);
      assert.equal(row.old_data.first_name, 'Audit');
    });

    await scenario('20. Audit records supplied actor user ID', async () => {
      const adminUser = await createUser('admin');

      // Actor is supplied by a trusted server component.
      await db.query(
        `SELECT set_config(
          'kms.actor_user_id',
          $1,
          TRUE
        )`,
        [String(adminUser)]
      );

      const parentId = await createParent();

      const row = await audit(
        'parents',
        parentId,
        'INSERT'
      );

      assert.ok(row);
      assert.equal(
        String(row.actor_user_id),
        String(adminUser)
      );
    });

    await scenario('21. Invalid actor ID is not stored', async () => {
      await db.query(
        `SELECT set_config(
          'kms.actor_user_id',
          'invalid-user-id',
          TRUE
        )`
      );

      const parentId = await createParent();

      const row = await audit(
        'parents',
        parentId,
        'INSERT'
      );

      assert.ok(row);
      assert.equal(row.actor_user_id, null);
    });

    await scenario('22. Composite-key link is audited', async () => {
      const childId = await createChild();
      const parentId = await createParent();

      await db.query(
        'SELECT kms_link_parent_to_child($1, $2)',
        [childId, parentId]
      );

      const recordKey = `${childId}:${parentId}`;

      const row = await audit(
        'children_parents',
        recordKey,
        'INSERT'
      );

      assert.ok(row);
      assert.equal(
        String(row.new_data.child_id),
        String(childId)
      );

      assert.equal(
        String(row.new_data.parent_id),
        String(parentId)
      );
    });

    await scenario('23. Issued invoice is audited', async () => {
      const childId = await createChild();

      const result = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1, DATE '2026-10-01', 1, 5
         )`,
        [childId]
      );

      const invoiceId = result.rows[0].id;

      const row = await audit(
        'invoices',
        invoiceId,
        'INSERT'
      );

      assert.ok(row);
      assert.equal(
        row.new_data.status,
        'issued'
      );
    });

    await t.test('24. Rolled-back changes leave no audit entry', async () => {
      let parentId;

      await db.query('BEGIN');

      try {
        parentId = await createParent();

        const insideTransaction = await audit(
          'parents',
          parentId,
          'INSERT'
        );

        assert.ok(insideTransaction);
      } finally {
        await db.query('ROLLBACK');
      }

      const afterRollback = await audit(
        'parents',
        parentId,
        'INSERT'
      );

      assert.equal(afterRollback, undefined);
    });

  } finally {
    try {
      await db?.end();
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
  }
});
