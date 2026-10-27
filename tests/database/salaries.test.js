
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

test('Salaries SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_salaries_test_${randomUUID().replaceAll('-', '')}`;

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

    function scenario(name, action) {
      return t.test(name, () => rollback(action));
    }

    async function value(sql, params = []) {
      const result = await db.query(sql, params);
      return Number(Object.values(result.rows[0])[0]);
    }

    async function createEmployee(
      position = 'teacher',
      status = 'active'
    ) {
      const n = ++counter;

      const result = await db.query(
        `INSERT INTO employees
          (first_name, last_name, phone,
           position, salary, status)
         VALUES ('Test', $1, $2, $3, 10000, $4)
         RETURNING id`,
        [
          `Employee${n}`,
          `38050${String(n).padStart(7, '0')}`,
          position,
          status,
        ]
      );

      return result.rows[0].id;
    }

    async function createGroup() {
      const n = ++counter;

      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 20) RETURNING id`,
        [`Salary Room ${n}`]
      );

      const result = await db.query(
        `INSERT INTO groups
          (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 20)
         RETURNING id`,
        [`Salary Group ${n}`, room.rows[0].id]
      );

      return result.rows[0].id;
    }

    async function assignEmployee(groupId, employeeId, role) {
      await db.query(
        'SELECT kms_assign_employee_to_group($1, $2, $3)',
        [groupId, employeeId, role]
      );
    }

    async function addChildren(groupId, count) {
      for (let i = 0; i < count; i++) {
        const n = ++counter;

        await db.query(
          `INSERT INTO children
             (first_name, last_name, date_of_birth, group_id)
           VALUES (
             'Test',
             $1,
             (CURRENT_DATE - INTERVAL '3 years')::date,
             $2
           )`,
          [`Child${n}`, groupId]
        );
      }
    }

    async function salary(employeeId, date = '2026-11-01') {
      return value(
        `SELECT kms_calculate_employee_salary(
           $1, $2::date
         ) AS amount`,
        [employeeId, date]
      );
    }

    async function setting(name, date = '2026-10-01') {
      return value(
        `SELECT kms_salary_setting(
          $1, $2::date
        ) AS amount`,
        [name, date]
      );
    }

    await t.test('1. Default salary parameters', async () => {
      const expected = {
        educator_per_child: 2000,
        educator_extra: 5000,
        assistant_base: 20000,
        assistant_extra: 3000,
        manager_base: 80000,
        teacher_base: 40000,
        bonus_threshold: 12,
        room_normative: 50000,
      };

      for (const [name, amount] of Object.entries(expected)) {
        assert.equal(await setting(name), amount);
      }
    });

    await scenario('2. Reject unknown salary parameter', async () => {
      await assert.rejects(
        db.query(
          `SELECT kms_salary_setting(
            'unknown_parameter'
          )`
        ),
        /KMS_SALARY_PARAMETER_NOT_FOUND/
      );
    });

    await scenario('3. Update salary parameter with history', async () => {
      await db.query(
        `SELECT *
         FROM kms_set_salary_setting(
           'teacher_base',
           45000,
           DATE '2027-01-01'
         )`
      );

      assert.equal(
        await setting('teacher_base', '2026-12-31'),
        40000
      );

      assert.equal(
        await setting('teacher_base', '2027-01-01'),
        45000
      );
    });

    await t.test('4. Reject invalid salary settings', async () => {
      const invalid = [
        ['', 20000, '2027-01-01'],
        ['teacher_base', -100, '2027-01-01'],
        ['teacher_base', null, '2027-01-01'],
        ['teacher_base', 40000, null],
      ];

      for (const params of invalid) {
        await rollback(async () => {
          await assert.rejects(
            db.query(
              `SELECT kms_set_salary_setting(
                $1, $2, $3::date
              )`,
              params
            ),
            /KMS_INVALID_SALARY_SETTING/
          );
        });
      }
    });

    await scenario('5. Reject unsupported salary setting', async () => {
      await assert.rejects(
        db.query(
          `SELECT kms_set_salary_setting(
            'unknown_bonus',
            1000,
            DATE '2027-01-01'
          )`
        ),
        /KMS_UNKNOWN_SALARY_SETTING/
      );
    });

    await scenario('6. Reject fractional bonus threshold', async () => {
      await assert.rejects(
        db.query(
          `SELECT kms_set_salary_setting(
            'bonus_threshold',
            12.5,
            DATE '2027-01-01'
          )`
        ),
        /KMS_INVALID_THRESHOLD/
      );
    });

    await scenario('7. Reject duplicate parameter date', async () => {
      await assert.rejects(
        db.query(
          `SELECT kms_set_salary_setting(
            'teacher_base',
            45000,
            DATE '2020-01-01'
          )`
        ),
        { code: '23505' }
      );
    });

    await scenario('8. Calculate manager salary', async () => {
      const employeeId = await createEmployee('manager');

      const result = await salary(employeeId);

      assert.equal(result, 80000);
    });

    await scenario('9. Calculate teacher salary', async () => {
      const employeeId = await createEmployee('teacher');

      const result = await salary(employeeId);

      assert.equal(result, 40000);
    });

    await scenario('10. Educator with no children', async () => {
      const groupId = await createGroup();
      const educatorId = await createEmployee('educator');

      await assignEmployee(groupId, educatorId, 'educator');

      assert.equal(await salary(educatorId), 0);
    });

    await scenario('11. Educator with 12 children', async () => {
      const groupId = await createGroup();
      const educatorId = await createEmployee('educator');

      await assignEmployee(groupId, educatorId, 'educator');
      await addChildren(groupId, 12);

      // 12 * 2000 = 24000
      assert.equal(await salary(educatorId), 24000);
    });

    await scenario('12. Educator with 13 children receives bonus', async () => {
      const groupId = await createGroup();
      const educatorId = await createEmployee('educator');

      await assignEmployee(groupId, educatorId, 'educator');
      await addChildren(groupId, 13);

      // 13 * 2000 + 1 * 5000 = 31000
      assert.equal(await salary(educatorId), 31000);
    });

    await scenario('13. Assistant salary with 13 children', async () => {
      const groupId = await createGroup();
      const assistantId = await createEmployee('assistant');

      await assignEmployee(groupId, assistantId, 'assistant');
      await addChildren(groupId, 13);

      // 20000 + 1 * 3000 = 23000
      assert.equal(await salary(assistantId), 23000);
    });

    await scenario('14. Reject inactive employee salary', async () => {
      const employeeId = await createEmployee(
        'teacher',
        'inactive'
      );

      await assert.rejects(
        db.query(
          'SELECT kms_calculate_employee_salary($1)',
          [employeeId]
        ),
        /KMS_EMPLOYEE_NOT_ACTIVE/
      );
    });

    await scenario('15. Reject unsupported employee position', async () => {
      const employeeId = await createEmployee('cook');

      await assert.rejects(
        db.query(
          'SELECT kms_calculate_employee_salary($1)',
          [employeeId]
        ),
        /KMS_SALARY_RULE_NOT_DEFINED/
      );
    });

    await scenario('16. Reject nonexistent employee', async () => {
      await assert.rejects(
        db.query(
          'SELECT kms_calculate_employee_salary(-1)'
        ),
        /KMS_EMPLOYEE_NOT_FOUND/
      );
    });

    await scenario('17. Create monthly salary record', async () => {
      const employeeId = await createEmployee('teacher');

      const result = await db.query(
        `SELECT *
         FROM kms_create_salary(
           $1, DATE '2026-11-01'
         )`,
        [employeeId]
      );

      const record = result.rows[0];

      assert.equal(Number(record.base_salary), 40000);
      assert.equal(Number(record.bonus), 0);
      assert.equal(Number(record.deductions), 0);
      assert.equal(Number(record.net_salary), 40000);
      assert.equal(record.currency, 'UAH');

      const dates = await db.query(
        `SELECT
           period_start::text AS period_start,
           period_end::text AS period_end
         FROM salaries
         WHERE id = $1`,
        [record.id]
      );

      assert.equal(
        dates.rows[0].period_start,
        '2026-11-01'
      );

      assert.equal(
        dates.rows[0].period_end,
        '2026-11-30'
      );
    });

    await scenario('18. Reject duplicate salary period', async () => {
      const employeeId = await createEmployee('teacher');

      await db.query(
        `SELECT *
         FROM kms_create_salary(
           $1, DATE '2026-11-01'
         )`,
        [employeeId]
      );

      await assert.rejects(
        db.query(
          `SELECT *
           FROM kms_create_salary(
             $1, DATE '2026-11-01'
           )`,
          [employeeId]
        ),
        {
          code: '23505',
          constraint: 'kms_salary_unique_period',
        }
      );
    });

    await t.test('19. Reject invalid salary periods', async () => {
      for (const date of ['2026-11-02', null]) {
        await rollback(async () => {
          const employeeId = await createEmployee('teacher');

          await assert.rejects(
            db.query(
              `SELECT *
               FROM kms_create_salary(
                 $1, $2::date
               )`,
              [employeeId, date]
            ),
            /KMS_INVALID_SALARY_PERIOD/
          );
        });
      }
    });

    await scenario('20. New parameter changes future salary', async () => {
      const employeeId = await createEmployee('teacher');

      await db.query(
        `SELECT *
         FROM kms_set_salary_setting(
           'teacher_base',
           42000,
           DATE '2027-01-01'
         )`
      );

      assert.equal(
        await salary(employeeId, '2026-12-01'),
        40000
      );

      assert.equal(
        await salary(employeeId, '2027-01-01'),
        42000
      );
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
