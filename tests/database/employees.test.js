
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

test('Employees and group staffing SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_staff_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });

  let db;
  let adminConnected = false;
  let created = false;
  let counter = 0;

  try {
    await admin.connect();
    adminConnected = true;

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

    async function createGroup() {
      const n = ++counter;

      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 10)
         RETURNING id`,
        [`Test Room ${n}`]
      );

      const group = await db.query(
        `INSERT INTO groups
           (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 10)
         RETURNING id`,
        [`Test Group ${n}`, room.rows[0].id]
      );

      return group.rows[0].id;
    }

    async function createEmployee(
      position,
      status = 'active'
    ) {
      const n = ++counter;

      const result = await db.query(
        `INSERT INTO employees
           (first_name, last_name, phone,
            position, salary, status)
         VALUES ($1, $2, $3, $4, 10000, $5)
         RETURNING id`,
        [
          'Test',
          `Employee${n}`,
          `38050${String(n).padStart(7, '0')}`,
          position,
          status,
        ]
      );

      return result.rows[0].id;
    }

    async function assign(groupId, employeeId, role) {
      return db.query(
        'SELECT kms_assign_employee_to_group($1, $2, $3)',
        [groupId, employeeId, role]
      );
    }

    async function createStaffedGroup() {
      const groupId = await createGroup();
      const educatorId = await createEmployee('educator');
      const assistantId = await createEmployee('assistant');

      await assign(groupId, educatorId, 'educator');
      await assign(groupId, assistantId, 'assistant');

      return { groupId, educatorId, assistantId };
    }

    await t.test('1. Assign educator and assistant', async () => {
      await rollback(async () => {
        const { groupId } = await createStaffedGroup();

        const result = await db.query(
          'SELECT role FROM group_staff WHERE group_id = $1 ORDER BY role',
          [groupId]
        );

        assert.deepEqual(
          result.rows.map((row) => row.role),
          ['assistant', 'educator']
        );
      });
    });

    await t.test('2. Activate fully staffed group', async () => {
      await rollback(async () => {
        const { groupId } = await createStaffedGroup();

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );

        const result = await db.query(
          'SELECT status FROM groups WHERE id = $1',
          [groupId]
        );

        assert.equal(result.rows[0].status, 'active');
      });
    });

    await t.test('3. Reject activation without staff', async () => {
      await rollback(async () => {
        const groupId = await createGroup();

        await assert.rejects(
          db.query(
            'SELECT kms_activate_group($1)',
            [groupId]
          ),
          /KMS_GROUP_REQUIRES_EDUCATOR_AND_ASSISTANT/
        );
      });
    });

    await t.test('4. Reject activation without assistant', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const educatorId = await createEmployee('educator');

        await assign(groupId, educatorId, 'educator');

        await assert.rejects(
          db.query(
            'SELECT kms_activate_group($1)',
            [groupId]
          ),
          /KMS_GROUP_REQUIRES_EDUCATOR_AND_ASSISTANT/
        );
      });
    });

    await t.test('5. Reject inactive employee', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const employeeId = await createEmployee(
          'educator',
          'inactive'
        );

        await assert.rejects(
          assign(groupId, employeeId, 'educator'),
          /KMS_EMPLOYEE_INACTIVE/
        );
      });
    });

    await t.test('6. Reject employee role mismatch', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const employeeId = await createEmployee('assistant');

        await assert.rejects(
          assign(groupId, employeeId, 'educator'),
          /KMS_EMPLOYEE_ROLE_MISMATCH/
        );
      });
    });

    await t.test('7. Reject invalid staff role', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const employeeId = await createEmployee('teacher');

        await assert.rejects(
          assign(groupId, employeeId, 'teacher'),
          /KMS_INVALID_STAFF_ROLE/
        );
      });
    });

    await t.test('8. Reject employee assigned to two groups', async () => {
      await rollback(async () => {
        const firstGroup = await createGroup();
        const secondGroup = await createGroup();
        const employeeId = await createEmployee('educator');

        await assign(firstGroup, employeeId, 'educator');

        await assert.rejects(
          assign(secondGroup, employeeId, 'educator'),
          /KMS_EMPLOYEE_ALREADY_ASSIGNED/
        );
      });
    });

    await t.test('9. Reject removing staff from active group', async () => {
      await rollback(async () => {
        const { groupId, educatorId } =
          await createStaffedGroup();

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );

        await assert.rejects(
          db.query(
            'SELECT kms_remove_employee_from_group($1, $2)',
            [groupId, educatorId]
          ),
          /KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE/
        );
      });
    });

    await t.test('10. Reject deactivation of assigned employee', async () => {
      await rollback(async () => {
        const { educatorId } = await createStaffedGroup();

        await assert.rejects(
          db.query(
            `UPDATE employees
             SET status = 'inactive'
             WHERE id = $1`,
            [educatorId]
          ),
          /KMS_EMPLOYEE_HAS_INCOMPATIBLE_ASSIGNMENT/
        );
      });
    });

    await t.test('11. Reject position change of assigned employee', async () => {
      await rollback(async () => {
        const { educatorId } = await createStaffedGroup();

        await assert.rejects(
          db.query(
            `UPDATE employees
             SET position = 'assistant'
             WHERE id = $1`,
            [educatorId]
          ),
          /KMS_EMPLOYEE_HAS_INCOMPATIBLE_ASSIGNMENT/
        );
      });
    });

    await t.test('12. Deactivate group and replace employee', async () => {
      await rollback(async () => {
        const { groupId, educatorId } =
          await createStaffedGroup();

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );

        await db.query(
          'SELECT kms_deactivate_group($1)',
          [groupId]
        );

        await db.query(
          'SELECT kms_remove_employee_from_group($1, $2)',
          [groupId, educatorId]
        );

        const newEducator = await createEmployee('educator');

        await assign(groupId, newEducator, 'educator');

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );

        const result = await db.query(
          `SELECT status FROM groups WHERE id = $1`,
          [groupId]
        );

        assert.equal(result.rows[0].status, 'active');

        const staff = await db.query(
          `SELECT employee_id FROM group_staff
           WHERE group_id = $1 AND role = 'educator'`,
          [groupId]
        );

        assert.equal(staff.rows[0].employee_id, newEducator);
      });
    });

    await t.test('13. Direct SQL insert also checks roles', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const employeeId = await createEmployee('assistant');

        await assert.rejects(
          db.query(
            `INSERT INTO group_staff
               (group_id, employee_id, role)
             VALUES ($1, $2, 'educator')`,
            [groupId, employeeId]
          ),
          /KMS_EMPLOYEE_ROLE_MISMATCH/
        );
      });
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
        if (adminConnected) {
          await admin.end();
        }
      }
    }
  }
});
