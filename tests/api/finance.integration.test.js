
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { Client } from 'pg';
import { createSession } from '../../src/utils/sessions.js';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

// Контрольні приклади (тарифи з міграцій 0006, 0007, 0009):
// навчання 15000 грн/міс, харчування 3 роки — 400 грн/день,
// річна оплата — знижка 12 % після персональної пільги,
// менеджер 80000, викладач 40000.
const PERIOD = '2026-12-01';
const REPORT = { start_date: '2026-12-01', end_date: '2026-12-31' };

test('Invoices, payments and finance reports HTTP integration', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_finance_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let appPool;
  let created = false;
  let connected = false;
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

    // PGDATABASE потрібно встановити до імпорту app.js.
    process.env.PGDATABASE = dbName;

    const { default: app } = await import('../../src/app.js');
    const { pool } = await import('../../src/config/database.js');

    appPool = pool;

    // Створюємо тестового адміністратора.
    const adminUser = await pool.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        `finance_admin_${randomUUID().slice(0, 8)}`,
        'test-hash',
        'admin',
      ]
    );

    // Отримуємо токен адміністратора.
    const adminToken = createSession(adminUser.rows[0].id).token;

    // Авторизовані POST-запити.
    async function post(path, body, status = 201) {
      const response = await request(app)
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);

      assert.equal(
        response.status,
        status,
        `POST ${path}: ${JSON.stringify(response.body)}`
      );

      return response.body.data;
    }

    // Авторизовані GET-запити.
    async function get(path, query = {}) {
      const response = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query(query);

      assert.equal(
        response.status,
        200,
        `GET ${path}: ${JSON.stringify(response.body)}`
      );

      return response.body.data;
    }

    const createChild = (firstName) =>
      post('/children', {
        first_name: firstName,
        last_name: 'Finance',
        date_of_birth: '2023-06-15',
      });

    const issueInvoice = (childId, months, mealDays) =>
      post('/invoices', {
        child_id: Number(childId),
        period_start: PERIOD,
        period_end: months === 12 ? '2027-11-30' : '2026-12-31',
        parameters: { months, meal_days: mealDays },
      });

    const pay = (invoiceId, amount, status = 201, transactionId) =>
      post('/payments', {
        invoice_id: Number(invoiceId),
        amount,
        method: 'card',
        payment_date: '2026-12-05T10:00:00+02:00',
        transaction_id: transactionId ?? `finance-tx-${++counter}`,
      }, status);

 const createEmployee = (position, number, salary = 1) =>
  post('/employees', {
    first_name: 'Finance',
    last_name: `Employee${number}`,
    email: `finance${number}@example.com`,
    phone: `098${String(number).padStart(7, '0')}`,
    position,
    salary,
    status: 'active',
  });

    const regular = await createChild('Regular');
    const discounted = await createChild('Discounted');
    const annual = await createChild('Annual');
    const annualDiscounted = await createChild('AnnualDiscounted');

    let regularInvoice;
    let discountedInvoice;
    let annualInvoice;

    await t.test('Monthly invoice contains tuition and meals', async () => {
      regularInvoice = await issueInvoice(regular.id, 1, 20);

      assert.equal(regularInvoice.status, 'issued');
      assert.equal(Number(regularInvoice.tuition_amount), 15000);
      assert.equal(Number(regularInvoice.meal_amount), 8000);
      assert.equal(Number(regularInvoice.discount_amount), 0);
      assert.equal(Number(regularInvoice.total_amount), 23000);
    });

    await t.test('Personal discount reduces tuition only', async () => {
      const discount = await post('/discounts', {
        name: 'Finance 20%',
        percentage: 20,
        valid_from: '2026-01-01',
      });

      await post(`/discounts/${discounted.id}/discounts`, {
        discount_id: Number(discount.id),
      });

      discountedInvoice = await issueInvoice(discounted.id, 1, 20);

      assert.equal(Number(discountedInvoice.discount_amount), 3000);
      assert.equal(Number(discountedInvoice.meal_amount), 8000);
      assert.equal(Number(discountedInvoice.total_amount), 20000);
    });

    await t.test('Annual invoice applies 12% after personal discount', async () => {
      annualInvoice = await issueInvoice(annual.id, 12, 240);

      // 180000 - 12 % = 158400 + 240 * 400.
      assert.equal(Number(annualInvoice.tuition_amount), 180000);
      assert.equal(Number(annualInvoice.discount_amount), 21600);
      assert.equal(Number(annualInvoice.meal_amount), 96000);
      assert.equal(Number(annualInvoice.total_amount), 254400);

      const discount = await post('/discounts', {
        name: 'Finance 10%',
        percentage: 10,
        valid_from: '2026-01-01',
      });

      await post(`/discounts/${annualDiscounted.id}/discounts`, {
        discount_id: Number(discount.id),
      });

      const invoice = await issueInvoice(annualDiscounted.id, 12, 240);

      // 18000 персональна + 12 % від 162000 = 19440.
      assert.equal(Number(invoice.discount_amount), 37440);
      assert.equal(Number(invoice.total_amount), 238560);

      assert.equal(
        (await post(`/invoices/${invoice.id}/cancel`, {}, 200)).status,
        'cancelled'
      );
    });

    await t.test('Overlapping invoice for the same child is rejected', async () => {
      await request(app)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          child_id: Number(regular.id),
          period_start: PERIOD,
          period_end: '2026-12-31',
          parameters: { months: 1, meal_days: 5 },
        })
        .expect(409);
    });

    await t.test('Partial payment keeps invoice issued and shows balance', async () => {
      await pay(regularInvoice.id, 10000, 201, 'finance-partial');

      const invoice = await get(`/invoices/${regularInvoice.id}`);

      assert.equal(invoice.status, 'issued');
      assert.equal(Number(invoice.paid_amount), 10000);
      assert.equal(Number(invoice.balance_due), 13000);
    });

    await t.test('Repeated payment is not counted twice', async () => {
      const repeated = await pay(
        regularInvoice.id, 10000, 200, 'finance-partial'
      );

      assert.equal(Number(repeated.amount), 10000);

      const payments = await get(`/payments/${regularInvoice.id}/payments`);
      assert.equal(payments.length, 1);

      await pay(regularInvoice.id, 500, 409, 'finance-partial');
    });

    await t.test('Overpayment is rejected', async () => {
      await pay(regularInvoice.id, 13000.01, 409);

      const invoice = await get(`/invoices/${regularInvoice.id}`);
      assert.equal(Number(invoice.balance_due), 13000);
    });

    await t.test('Full payment marks invoice as paid', async () => {
      await pay(regularInvoice.id, 13000);

      const invoice = await get(`/invoices/${regularInvoice.id}`);

      assert.equal(invoice.status, 'paid');
      assert.equal(Number(invoice.paid_amount), 23000);
      assert.equal(Number(invoice.balance_due), 0);

      await pay(regularInvoice.id, 1, 409);
    });

    await t.test('Cancellation is allowed only without payments', async () => {
      await post(`/invoices/${regularInvoice.id}/cancel`, {}, 409);

      await pay(discountedInvoice.id, 100);
      await post(`/invoices/${discountedInvoice.id}/cancel`, {}, 409);

      const extra = await createChild('Cancelled');
      const invoice = await issueInvoice(extra.id, 1, 0);
      const cancelled = await post(`/invoices/${invoice.id}/cancel`, {}, 200);

      assert.equal(cancelled.status, 'cancelled');
      await pay(invoice.id, 100, 409);
    });

    await t.test('Concurrent identical payments create one record', async () => {
      // Рахунок зі знижкою: 20000, уже сплачено 100.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app)
            .post('/api/v1/payments')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              invoice_id: Number(discountedInvoice.id),
              amount: 500,
              method: 'card',
              payment_date: '2026-12-06T10:00:00+02:00',
              transaction_id: 'finance-concurrent',
            })
        )
      );

      const statuses = responses.map(r => r.status).sort();
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 201]);

      const ids = new Set(responses.map(r => r.body.data.id));
      assert.equal(ids.size, 1);

      const invoice = await get(`/invoices/${discountedInvoice.id}`);
      assert.equal(Number(invoice.paid_amount), 600);
      assert.equal(Number(invoice.balance_due), 19400);
    });

    await t.test('Concurrent payments cannot overpay the invoice', async () => {
      // Залишок 19400: пройдуть лише три платежі по 6000.
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          request(app)
            .post('/api/v1/payments')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              invoice_id: Number(discountedInvoice.id),
              amount: 6000,
              method: 'card',
              payment_date: '2026-12-07T10:00:00+02:00',
              transaction_id: `finance-parallel-${i}`,
            })
        )
      );

      const statuses = responses.map(r => r.status).sort();
      assert.deepEqual(statuses, [201, 201, 201, 409]);

      const invoice = await get(`/invoices/${discountedInvoice.id}`);
      assert.equal(Number(invoice.paid_amount), 18600);
      assert.equal(Number(invoice.balance_due), 1400);
      assert.equal(invoice.status, 'issued');
    });

    const manager = await createEmployee('manager', 1);
const teacher = await createEmployee('teacher', 2);

const director = await createEmployee('director', 3, 15000);
const cook = await createEmployee('cook', 4, 12000);
const nurse = await createEmployee('nurse', 5, 13000);
const accountant = await createEmployee('accountant', 6, 16000);

await t.test('Fixed salary positions use employees.salary through HTTP', async () => {
  const employees = [
    { employee: director, expectedSalary: 15000, position: 'director' },
    { employee: cook, expectedSalary: 12000, position: 'cook' },
    { employee: nurse, expectedSalary: 13000, position: 'nurse' },
    { employee: accountant, expectedSalary: 16000, position: 'accountant' },
  ];

  for (const { employee, expectedSalary, position } of employees) {
    const result = await get(`/employees/${employee.id}/salary`);

    assert.equal(
      Number(result.amount),
      expectedSalary,
      `${position} should receive the salary from employees.salary`
    );
  }
});

await t.test('POST /salaries creates salaries for fixed salary positions', async () => {
  const employees = [
    { employee: director, expectedSalary: 15000, position: 'director' },
    { employee: cook, expectedSalary: 12000, position: 'cook' },
    { employee: nurse, expectedSalary: 13000, position: 'nurse' },
    { employee: accountant, expectedSalary: 16000, position: 'accountant' },
  ];

  for (const { employee, expectedSalary, position } of employees) {
    const salary = await post('/salaries', {
      employee_id: Number(employee.id),
      period_start: PERIOD,
    }, 201);

    assert.equal(
      Number(salary.net_salary),
      expectedSalary,
      `${position} should receive employees.salary through POST /salaries`
    );
  }
});

    await t.test('Monthly salaries are recorded once per period', async () => {
      const salary = await post('/salaries', {
        employee_id: Number(manager.id),
        period_start: PERIOD,
      });

      assert.equal(Number(salary.net_salary), 80000);
      assert.equal(salary.period_end, '2026-12-31');

      await post('/salaries', {
        employee_id: Number(teacher.id),
        period_start: PERIOD,
      });

      await post('/salaries', {
        employee_id: Number(manager.id),
        period_start: PERIOD,
      }, 409);

      await post('/salaries', {
        employee_id: Number(manager.id),
        period_start: '2026-12-15',
      }, 400);
    });

    await t.test('Expenses are recorded', async () => {
      await post('/expenses', {
        name: 'Electricity',
        amount: 5000,
        date: '2026-12-10',
        category: 'utilities',
      });

      // Категорія salary не входить у фінзвіт — зарплати беруться з salaries.
      await post('/expenses', {
        name: 'Salary transfer fee',
        amount: 1000,
        date: '2026-12-11',
        category: 'salary',
      });
    });

    await t.test('Finance report matches control example', async () => {
      // Активні: звичайний рахунок 23000, рахунок зі знижкою 20000
      // і річний 254400 * 31 / 365 = 21606.58.
      const report = await get('/reports/finance', REPORT);

      assert.deepEqual(report, {
        revenue: '64606.58',
        payroll_cost: '176000.00',
        other_expenses: '5000.00',
        operating_profit: '-116393.42',
        room_model_cost: '0.00',
        modeled_profit: '-116393.42',
      });

      const revenue = await get('/reports/revenue', REPORT);
      assert.equal(revenue.revenue, '64606.58');

      const expenses = await get('/reports/expenses', REPORT);
      assert.deepEqual(
        expenses.map(row => [row.category, Number(row.total)]),
        [['salary', 1000], ['utilities', 5000]]
      );

      const salaries = await get('/reports/salaries', REPORT);
      assert.deepEqual(
        salaries.map(row => Number(row.total)),
        [80000, 40000, 15000, 12000, 13000, 16000]
      );
    });
  } finally {
    if (appPool) await appPool.end();

    if (created) {
      await admin.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`
      );
    }

    if (connected) await admin.end();
  }
});
