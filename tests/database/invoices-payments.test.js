
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

test('Invoices and payments SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_invoices_test_${randomUUID().replaceAll('-', '')}`;

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

    async function createChild() {
      const result = await db.query(
        `INSERT INTO children
          (first_name, last_name, date_of_birth)
         VALUES (
           'Invoice',
           'Test',
           DATE '2023-05-15'
         )
         RETURNING id`
      );

      return result.rows[0].id;
    }

    // FIX: SELECT * FROM викликає SQL-функцію один раз.
    async function issue({
      childId,
      date = '2026-10-01',
      months = 1,
      mealDays = 5,
    } = {}) {
      const id = childId ?? await createChild();

      const result = await db.query(
        `SELECT *
         FROM kms_issue_invoice(
           $1,
           $2::date,
           $3,
           $4
         )`,
        [id, date, months, mealDays]
      );

      return result.rows[0];
    }

    // FIX: платежі також створюються одним викликом.
    async function pay(
      invoiceId,
      amount,
      transactionId = `test-tx-${++counter}`,
      client = db
    ) {
      const result = await client.query(
        `SELECT *
         FROM kms_register_payment(
           $1,
           $2,
           'card',
           $3
         )`,
        [invoiceId, amount, transactionId]
      );

      return result.rows[0];
    }

    async function balance(invoiceId) {
      const result = await db.query(
        `SELECT kms_invoice_balance($1) AS balance`,
        [invoiceId]
      );

      return Number(result.rows[0].balance);
    }

    await scenario('1. Issue monthly invoice', async () => {
      const invoice = await issue();

      assert.equal(invoice.status, 'issued');

      assert.equal(
        Number(invoice.tuition_amount),
        15000
      );

      assert.equal(
        Number(invoice.meal_amount),
        2000
      );

      assert.equal(
        Number(invoice.discount_amount),
        0
      );

      assert.equal(
        Number(invoice.total_amount),
        17000
      );

      assert.equal(
        await balance(invoice.id),
        17000
      );
    });

    await scenario('2. Issue annual invoice', async () => {
      const invoice = await issue({
        months: 12,
        mealDays: 10,
      });

      assert.equal(
        Number(invoice.tuition_amount),
        180000
      );

      assert.equal(
        Number(invoice.meal_amount),
        4000
      );

      assert.equal(
        Number(invoice.discount_amount),
        21600
      );

      assert.equal(
        Number(invoice.total_amount),
        162400
      );
    });

    await t.test('3. Reject invalid invoice periods', async () => {
      const invalidPeriods = [
        {
          date: '2026-10-02',
          months: 1,
          mealDays: 5,
        },
        {
          date: '2026-10-01',
          months: 2,
          mealDays: 5,
        },
        {
          date: '2026-10-01',
          months: 1,
          mealDays: 32,
        },
        {
          date: '2026-10-01',
          months: 12,
          mealDays: 367,
        },
      ];

      for (const params of invalidPeriods) {
        await rollback(async () => {
          await assert.rejects(
            issue(params),
            /KMS_INVALID_INVOICE_PERIOD/
          );
        });
      }
    });

    await scenario('4. Reject nonexistent child', async () => {
      await assert.rejects(
        issue({ childId: -1 }),
        /KMS_CHILD_NOT_FOUND/
      );
    });

    await scenario('5. Reject overlapping invoices', async () => {
      const childId = await createChild();

      await issue({ childId });

      await assert.rejects(
        issue({ childId }),
        {
          code: '23P01',
          constraint: 'kms_invoice_no_overlap',
        }
      );
    });

    await scenario('6. Reissue after cancellation', async () => {
      const childId = await createChild();

      const first = await issue({ childId });

      await db.query(
        'SELECT kms_cancel_invoice($1)',
        [first.id]
      );

      const second = await issue({ childId });

      assert.equal(second.status, 'issued');
      assert.notEqual(second.id, first.id);
    });

    await scenario('7. Partial payment', async () => {
      const invoice = await issue();

      await pay(invoice.id, 6000);

      assert.equal(
        await balance(invoice.id),
        11000
      );

      const result = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoice.id]
      );

      assert.equal(result.rows[0].status, 'issued');
    });

    await scenario('8. Full payment closes invoice', async () => {
      const invoice = await issue();

      await pay(invoice.id, 6000);
      await pay(invoice.id, 11000);

      assert.equal(
        await balance(invoice.id),
        0
      );

      const result = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoice.id]
      );

      assert.equal(result.rows[0].status, 'paid');
    });

    await scenario('9. Reject overpayment', async () => {
      const invoice = await issue();

      await assert.rejects(
        pay(invoice.id, 17001),
        /KMS_PAYMENT_EXCEEDS_BALANCE/
      );
    });

    await scenario('10. Reject cancellation after payment', async () => {
      const invoice = await issue();

      await pay(invoice.id, 1000);

      await assert.rejects(
        db.query(
          'SELECT kms_cancel_invoice($1)',
          [invoice.id]
        ),
        /KMS_INVOICE_HAS_PAYMENTS/
      );
    });

    await scenario('11. Reject payment of cancelled invoice', async () => {
      const invoice = await issue();

      await db.query(
        'SELECT kms_cancel_invoice($1)',
        [invoice.id]
      );

      await assert.rejects(
        pay(invoice.id, 100),
        /KMS_INVOICE_NOT_PAYABLE/
      );
    });

    await scenario('12. Identical payment retry is idempotent', async () => {
      const invoice = await issue();

      const transactionId = `retry-${++counter}`;

      const first = await pay(
        invoice.id,
        17000,
        transactionId
      );

      const second = await pay(
        invoice.id,
        17000,
        transactionId
      );

      assert.equal(first.id, second.id);

      const result = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM payments
         WHERE invoice_id = $1`,
        [invoice.id]
      );

      assert.equal(
        result.rows[0].count,
        1
      );
    });

    await scenario('13. Reject transaction ID reuse', async () => {
      const invoice = await issue();

      const transactionId = `conflict-${++counter}`;

      await pay(
        invoice.id,
        1000,
        transactionId
      );

      await assert.rejects(
        pay(invoice.id, 2000, transactionId),
        /KMS_TRANSACTION_ID_CONFLICT/
      );
    });

    await scenario('14. Issued invoice is immutable', async () => {
      const invoice = await issue();

      await assert.rejects(
        db.query(
          `UPDATE invoices
           SET tuition_amount = 100
           WHERE id = $1`,
          [invoice.id]
        ),
        /KMS_ISSUED_INVOICE_IMMUTABLE/
      );
    });

    await t.test('15. Payments cannot be edited or deleted', async () => {
      await rollback(async () => {
        const invoice = await issue();

        const payment = await pay(
          invoice.id,
          1000
        );

        await assert.rejects(
          db.query(
            `UPDATE payments
             SET amount = 200
             WHERE id = $1`,
            [payment.id]
          ),
          /KMS_PAYMENT_IMMUTABLE/
        );
      });

      await rollback(async () => {
        const invoice = await issue();

        const payment = await pay(
          invoice.id,
          1000
        );

        await assert.rejects(
          db.query(
            `DELETE FROM payments
             WHERE id = $1`,
            [payment.id]
          ),
          /KMS_PAYMENT_IMMUTABLE/
        );
      });
    });

    await scenario('16. Reject payment currency mismatch', async () => {
      const invoice = await issue();

      await assert.rejects(
        db.query(
          `INSERT INTO payments (
             invoice_id,
             amount,
             method,
             transaction_id,
             payment_date,
             currency
           )
           VALUES (
             $1,
             100,
             'card',
             $2,
             NOW(),
             'USD'
           )`,
          [
            invoice.id,
            `currency-${++counter}`,
          ]
        ),
        /KMS_PAYMENT_CURRENCY_MISMATCH/
      );
    });

    await scenario('17. Require transaction ID', async () => {
      const invoice = await issue();

      await assert.rejects(
        pay(invoice.id, 100, ''),
        /KMS_TRANSACTION_ID_REQUIRED/
      );
    });

    await scenario('18. Reject unknown invoice balance', async () => {
      await assert.rejects(
        balance(-1),
        /KMS_INVOICE_NOT_FOUND/
      );
    });

    await t.test('19. Concurrent full payments cannot overpay', async () => {
      const invoice = await issue();

      const clientA = new Client({
        database: dbName,
        connectionTimeoutMillis: 3000,
      });

      const clientB = new Client({
        database: dbName,
        connectionTimeoutMillis: 3000,
      });

      try {
        await Promise.all([
          clientA.connect(),
          clientB.connect(),
        ]);

        const results = await Promise.allSettled([
          pay(
            invoice.id,
            17000,
            `race-a-${++counter}`,
            clientA
          ),
          pay(
            invoice.id,
            17000,
            `race-b-${++counter}`,
            clientB
          ),
        ]);

        const successful = results.filter(
          (result) => result.status === 'fulfilled'
        );

        const rejected = results.filter(
          (result) => result.status === 'rejected'
        );

        assert.equal(successful.length, 1);
        assert.equal(rejected.length, 1);

        assert.match(
          rejected[0].reason.message,
          /KMS_INVOICE_NOT_PAYABLE/
        );

        assert.equal(
          await balance(invoice.id),
          0
        );

        const count = await db.query(
          `SELECT COUNT(*)::int AS total
           FROM payments
           WHERE invoice_id = $1`,
          [invoice.id]
        );

        assert.equal(count.rows[0].total, 1);
      } finally {
        await Promise.allSettled([
          clientA.end(),
          clientB.end(),
        ]);
      }
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
