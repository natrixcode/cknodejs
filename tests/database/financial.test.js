
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

test('Financial reports and forecasts SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_financial_test_${randomUUID().replaceAll('-', '')}`;

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
      env: {
        ...process.env,
        PGDATABASE: dbName,
      },
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

    function numericRow(row) {
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value === null ? null : Number(value),
        ])
      );
    }

    async function createEmployee(position) {
      const n = ++counter;

      const result = await db.query(
        `INSERT INTO employees
          (first_name, last_name, phone,
           position, salary)
         VALUES ('Test', $1, $2, $3, 10000)
         RETURNING id`,
        [
          `FinancialEmployee${n}`,
          `38050${String(n).padStart(7, '0')}`,
          position,
        ]
      );

      return result.rows[0].id;
    }

    async function createGroup(active = false) {
      const n = ++counter;

      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 20)
         RETURNING id`,
        [`Financial Room ${n}`]
      );

      const result = await db.query(
        `INSERT INTO groups
          (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 20)
         RETURNING id`,
        [`Financial Group ${n}`, room.rows[0].id]
      );

      const groupId = result.rows[0].id;
      const staff = {};

      if (active) {
        for (const role of ['educator', 'assistant']) {
          const employeeId = await createEmployee(role);

          await db.query(
            'SELECT kms_assign_employee_to_group($1, $2, $3)',
            [groupId, employeeId, role]
          );

          staff[role] = employeeId;
        }

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );
      }

      return { groupId, staff };
    }

    async function createChild(groupId = null) {
      const result = await db.query(
        `INSERT INTO children
          (first_name, last_name, date_of_birth, group_id)
         VALUES ('Financial', 'Child', DATE '2023-05-15', $1)
         RETURNING id`,
        [groupId]
      );

      return result.rows[0].id;
    }

    async function issueInvoice(
      childId,
      date = '2026-10-01',
      months = 1,
      mealDays = 5
    ) {
      const result = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1, $2::date, $3, $4
         )`,
        [childId, date, months, mealDays]
      );

      return result.rows[0];
    }

    async function createSalary(
      employeeId,
      date = '2026-10-01'
    ) {
      const result = await db.query(
        `SELECT *
         FROM kms_create_salary($1, $2::date)`,
        [employeeId, date]
      );

      return result.rows[0];
    }

    async function addExpense(amount, category = 'utilities') {
      const result = await db.query(
        `INSERT INTO expenses
           (name, amount, date, category)
         VALUES ('Test expense', $1, DATE '2026-10-15', $2)
         RETURNING id`,
        [amount, category]
      );

      return result.rows[0].id;
    }

    async function financialReport(
      start = '2026-10-01',
      end = '2026-10-31',
      basis = 'accrual'
    ) {
      const result = await db.query(
        `SELECT *
         FROM kms_financial_report(
           $1::date, $2::date, $3
         )`,
        [start, end, basis]
      );

      return numericRow(result.rows[0]);
    }

    async function groupReport(groupId) {
      const result = await db.query(
        `SELECT *
         FROM kms_group_financial_report(
           $1,
           DATE '2026-10-01',
           DATE '2026-10-31'
         )`,
        [groupId]
      );

      return numericRow(result.rows[0]);
    }

    async function forecast(
      age = 3,
      children = 10,
      groups = 1,
      rooms = 1,
      mealDays = 20,
      foodCost = 150,
      discount = 0
    ) {
      const result = await db.query(
        `SELECT *
         FROM kms_forecast_groups(
           $1, $2, $3, $4, $5, $6, $7
         )`,
        [
          age,
          children,
          groups,
          rooms,
          mealDays,
          foodCost,
          discount,
        ]
      );

      return numericRow(result.rows[0]);
    }

    async function optimize(
      age = 3,
      children = 10,
      rooms = 3,
      mealDays = 20,
      foodCost = 150,
      discount = 0
    ) {
      const result = await db.query(
        `SELECT *
         FROM kms_optimize_group_count(
           $1, $2, $3, $4, $5, $6
         )`,
        [
          age,
          children,
          rooms,
          mealDays,
          foodCost,
          discount,
        ]
      );

      return numericRow(result.rows[0]);
    }

    await t.test('1. Empty financial report', async () => {
      const result = await financialReport();

      assert.deepEqual(result, {
        revenue: 0,
        payroll_cost: 0,
        other_expenses: 0,
        operating_profit: 0,
        room_model_cost: 0,
        modeled_profit: 0,
      });
    });

    await t.test('2. Reject invalid report parameters', async () => {
      const cases = [
        ['2026-11-01', '2026-10-31', 'accrual'],
        [null, '2026-10-31', 'accrual'],
        ['2026-10-01', null, 'accrual'],
        ['2026-10-01', '2026-10-31', 'weekly'],
      ];

      for (const params of cases) {
        await rollback(async () => {
          await assert.rejects(
            financialReport(...params),
            /KMS_INVALID_REPORT_PARAMETERS/
          );
        });
      }
    });

    await t.test('3. Report requires complete months', async () => {
      const cases = [
        ['2026-10-02', '2026-10-31'],
        ['2026-10-01', '2026-10-30'],
      ];

      for (const params of cases) {
        await rollback(async () => {
          await assert.rejects(
            financialReport(...params),
            /KMS_REPORT_REQUIRES_FULL_MONTHS/
          );
        });
      }
    });

    await scenario('4. Accrual revenue counts issued invoices', async () => {
      const childId = await createChild();

      await issueInvoice(childId);

      const result = await financialReport();

      assert.equal(result.revenue, 17000);
      assert.equal(result.operating_profit, 17000);
    });

    await scenario('5. Cash revenue counts actual payments', async () => {
      const childId = await createChild();
      const invoice = await issueInvoice(childId);

      await db.query(
        `SELECT *
         FROM kms_register_payment(
           $1,
           6000,
           'card',
           $2,
           TIMESTAMPTZ '2026-10-15 12:00:00+03'
         )`,
        [invoice.id, `financial-payment-${++counter}`]
      );

      const accrual = await financialReport(
        '2026-10-01',
        '2026-10-31',
        'accrual'
      );

      const cash = await financialReport(
        '2026-10-01',
        '2026-10-31',
        'cash'
      );

      assert.equal(accrual.revenue, 17000);
      assert.equal(cash.revenue, 6000);
    });

    await scenario('6. Cancelled invoices are excluded', async () => {
      const childId = await createChild();
      const invoice = await issueInvoice(childId);

      await db.query(
        'SELECT kms_cancel_invoice($1)',
        [invoice.id]
      );

      const result = await financialReport();

      assert.equal(result.revenue, 0);
    });

    await scenario('7. Annual invoice is distributed by days', async () => {
      const childId = await createChild();

      await issueInvoice(
        childId,
        '2026-01-01',
        12,
        0
      );

      const result = await financialReport(
        '2026-02-01',
        '2026-02-28'
      );

      const expected = Number(
        (158400 * 28 / 365).toFixed(2)
      );

      assert.equal(result.revenue, expected);
    });

    await scenario('8. Report separates payroll and expenses', async () => {
      const employeeId = await createEmployee('teacher');

      await createSalary(employeeId);

      await addExpense(2000, 'utilities');

      // Must not count salary-category expenses twice.
      await addExpense(5000, 'salary');

      const result = await financialReport();

      assert.equal(result.payroll_cost, 40000);
      assert.equal(result.other_expenses, 2000);
      assert.equal(result.operating_profit, -42000);
    });

    await scenario('9. Active group adds room model cost', async () => {
      await createGroup(true);

      const result = await financialReport();

      assert.equal(result.room_model_cost, 50000);
      assert.equal(result.modeled_profit, -50000);
    });

    await scenario('10. Room cost scales across months', async () => {
      await createGroup(true);

      const result = await financialReport(
        '2026-10-01',
        '2026-11-30'
      );

      assert.equal(result.room_model_cost, 100000);
    });

    await scenario('11. Empty group financial report', async () => {
      const { groupId } = await createGroup();

      const result = await groupReport(groupId);

      assert.deepEqual(result, {
        group_revenue: 0,
        direct_salary_cost: 0,
        direct_profit: 0,
      });
    });

    await scenario('12. Group report calculates direct profit', async () => {
      const { groupId, staff } = await createGroup(true);

      const childId = await createChild(groupId);
      await issueInvoice(childId);

      await createSalary(staff.educator);
      await createSalary(staff.assistant);

      const result = await groupReport(groupId);

      assert.equal(result.group_revenue, 17000);
      assert.equal(result.direct_salary_cost, 22000);
      assert.equal(result.direct_profit, -5000);
    });

    await scenario('13. Group report does not count other groups', async () => {
      const first = await createGroup();
      const second = await createGroup();

      const childId = await createChild(first.groupId);

      await issueInvoice(childId);

      const firstResult = await groupReport(first.groupId);
      const secondResult = await groupReport(second.groupId);

      assert.equal(firstResult.group_revenue, 17000);
      assert.equal(secondResult.group_revenue, 0);
    });

    await scenario('14. Reject missing group', async () => {
      await assert.rejects(
        db.query(
          `SELECT *
           FROM kms_group_financial_report(
             -1,
             DATE '2026-10-01',
             DATE '2026-10-31'
           )`
        ),
        /KMS_GROUP_NOT_FOUND/
      );
    });

    await scenario('15. Reject invalid group report period', async () => {
      const { groupId } = await createGroup();

      await assert.rejects(
        db.query(
          `SELECT *
           FROM kms_group_financial_report(
             $1,
             DATE '2026-11-01',
             DATE '2026-10-31'
           )`,
          [groupId]
        ),
        /KMS_INVALID_REPORT_PERIOD/
      );
    });

    await t.test('16. Forecast for 10 children', async () => {
      const result = await forecast();

      assert.deepEqual(result, {
        group_count: 1,
        rooms_needed: 1,
        monthly_revenue: 230000,
        payroll_cost: 320000,
        food_procurement_cost: 30000,
        operating_profit: -120000,
        modeled_profit: -170000,
      });
    });

    await t.test('17. Forecast includes staff bonuses', async () => {
      const result = await forecast(
        3, 13, 1, 1, 20, 100, 10
      );

      assert.equal(result.monthly_revenue, 279500);
      assert.equal(result.payroll_cost, 334000);
      assert.equal(result.food_procurement_cost, 26000);
      assert.equal(result.operating_profit, -80500);
      assert.equal(result.modeled_profit, -130500);
    });

    await t.test('18. Forecast distributes children into groups', async () => {
      const result = await forecast(
        3, 25, 2, 2, 0, 0, 0
      );

      assert.equal(result.group_count, 2);
      assert.equal(result.rooms_needed, 2);
      assert.equal(result.monthly_revenue, 375000);
      assert.equal(result.payroll_cost, 378000);
      assert.equal(result.modeled_profit, -103000);
    });

    await t.test('19. Reject invalid forecast scenarios', async () => {
      const invalid = [
        [1, 10, 1, 1, 20, 150, 0],
        [3, 0, 1, 1, 20, 150, 0],
        [3, 10, 0, 1, 20, 150, 0],
        [3, 10, 2, 1, 20, 150, 0],
        [3, 21, 1, 1, 20, 150, 0],
        [3, 10, 1, 1, 32, 150, 0],
        [3, 10, 1, 1, 20, -10, 0],
        [3, 10, 1, 1, 20, 150, 50],
      ];

      for (const params of invalid) {
        await rollback(async () => {
          await assert.rejects(
            forecast(...params),
            /KMS_INVALID_FORECAST_SCENARIO/
          );
        });
      }
    });

    await t.test('20. Forecast discount reduces revenue', async () => {
      const withoutDiscount = await forecast(
        3, 10, 1, 1, 20, 150, 0
      );

      const withDiscount = await forecast(
        3, 10, 1, 1, 20, 150, 10
      );

      assert.equal(
        withoutDiscount.monthly_revenue -
          withDiscount.monthly_revenue,
        15000
      );

      assert.equal(
        withoutDiscount.payroll_cost,
        withDiscount.payroll_cost
      );
    });

    await t.test('21. Optimize group count for 10 children', async () => {
      const result = await optimize(
        3, 10, 3, 20, 150, 0
      );

      assert.equal(result.recommended_groups, 1);
      assert.equal(result.expected_operating_profit, -120000);
      assert.equal(result.expected_modeled_profit, -170000);
    });

    await t.test('22. Optimize group count for 25 children', async () => {
      const result = await optimize(
        3, 25, 3, 0, 0, 0
      );

      assert.equal(result.recommended_groups, 2);
      assert.equal(result.expected_modeled_profit, -103000);
    });

    await t.test('23. Reject forecast capacity overflow', async () => {
      await rollback(async () => {
        await assert.rejects(
          optimize(3, 41, 2, 20, 150, 0),
          /KMS_FORECAST_CAPACITY_EXCEEDED/
        );
      });
    });

    await t.test('24. Reject invalid optimization age', async () => {
      await rollback(async () => {
        await assert.rejects(
          optimize(6, 10, 2, 20, 150, 0),
          /KMS_INVALID_FORECAST_SCENARIO/
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
        if (connected) {
          await admin.end();
        }
      }
    }
  }
});
