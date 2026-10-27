
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

test('Tuition and discounts SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_tuition_test_${randomUUID().replaceAll('-', '')}`;

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

    async function amount(sql, params = []) {
      const result = await db.query(sql, params);
      return Number(result.rows[0].amount);
    }

    async function createChild() {
      const result = await db.query(`
        INSERT INTO children
          (first_name, last_name, date_of_birth)
        VALUES (
          'Test', 'Child',
          (CURRENT_DATE - INTERVAL '3 years')::date
        )
        RETURNING id
      `);

      return result.rows[0].id;
    }

    async function createDiscount(
      percentage = 10,
      active = true,
      daysFromToday = 0
    ) {
      const n = ++counter;

      const result = await db.query(`
        INSERT INTO discounts
          (name, type, value, valid_from, is_active)
        VALUES (
          $1, 'percent', $2,
          (CURRENT_DATE + $3::integer * INTERVAL '1 day')::date,
          $4
        )
        RETURNING id
      `, [
        `Test Discount ${n}`,
        percentage,
        daysFromToday,
        active,
      ]);

      return result.rows[0].id;
    }

    async function assignDiscount(childId, discountId) {
      return db.query(
        'SELECT kms_assign_child_discount($1, $2)',
        [childId, discountId]
      );
    }

    async function calculate(childId, months = 1, date = null) {
      const result = await db.query(
        `SELECT * FROM kms_calculate_tuition(
          $1,
          COALESCE($2::date, CURRENT_DATE),
          $3
        )`,
        [childId, date, months]
      );

      const row = result.rows[0];

      return {
        gross: Number(row.gross_amount),
        personal: Number(row.personal_discount),
        annual: Number(row.annual_discount),
        net: Number(row.net_amount),
      };
    }

    await t.test('1. Default tuition rate is 15000', async () => {
      const rate = await amount(
        'SELECT kms_get_tuition_rate(CURRENT_DATE) AS amount'
      );

      assert.equal(rate, 15000);
    });

    await t.test('2. New tuition rate preserves history', async () => {
      await rollback(async () => {
        await db.query(
          `SELECT kms_set_tuition_rate(
            18000, DATE '2025-01-01'
          )`
        );

        const oldRate = await amount(
          `SELECT kms_get_tuition_rate(
            DATE '2024-12-31'
          ) AS amount`
        );

        const newRate = await amount(
          `SELECT kms_get_tuition_rate(
            DATE '2025-02-01'
          ) AS amount`
        );

        assert.equal(oldRate, 15000);
        assert.equal(newRate, 18000);
      });
    });

    await t.test('3. Reject invalid tuition rates', async () => {
      for (const params of [
        [-100, '2025-01-01'],
        [null, '2025-01-01'],
        [15000, null],
      ]) {
        await rollback(async () => {
          await assert.rejects(
            db.query(
              'SELECT kms_set_tuition_rate($1, $2::date)',
              params
            ),
            /KMS_INVALID_TUITION_RATE/
          );
        });
      }
    });

    await t.test('4. Reject invalid tariff lookup', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            'SELECT kms_get_tuition_rate(NULL::date)'
          ),
          /KMS_INVALID_TUITION_DATE/
        );
      });

      await rollback(async () => {
        await assert.rejects(
          db.query(
            `SELECT kms_get_tuition_rate(
              DATE '2019-01-01'
            )`
          ),
          /KMS_TUITION_RATE_NOT_FOUND/
        );
      });
    });

    await t.test('5. Monthly tuition without discount', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const result = await calculate(childId);

        assert.deepEqual(result, {
          gross: 15000,
          personal: 0,
          annual: 0,
          net: 15000,
        });
      });
    });

    await t.test('6. Annual tuition gives 12 percent discount', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const result = await calculate(childId, 12);

        assert.deepEqual(result, {
          gross: 180000,
          personal: 0,
          annual: 21600,
          net: 158400,
        });
      });
    });

    await t.test('7. Reject invalid billing periods', async () => {
      for (const months of [0, 2, 13, null]) {
        await rollback(async () => {
          const childId = await createChild();

          await assert.rejects(
            db.query(
              `SELECT * FROM kms_calculate_tuition(
                $1, CURRENT_DATE, $2
              )`,
              [childId, months]
            ),
            /KMS_INVALID_BILLING_PERIOD/
          );
        });
      }

      await rollback(async () => {
        const childId = await createChild();

        await assert.rejects(
          db.query(
            `SELECT * FROM kms_calculate_tuition(
              $1, NULL::date, 1
            )`,
            [childId]
          ),
          /KMS_INVALID_BILLING_PERIOD/
        );
      });
    });

    await t.test('8. Reject nonexistent child', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            `SELECT * FROM kms_calculate_tuition(
              -1, CURRENT_DATE, 1
            )`
          ),
          /KMS_CHILD_NOT_FOUND/
        );
      });
    });

    await t.test('9. Allow discounts of 10, 20 and 30 percent', async () => {
      await rollback(async () => {
        for (const percentage of [10, 20, 30]) {
          const discountId = await createDiscount(percentage);

          const result = await db.query(
            'SELECT value FROM discounts WHERE id = $1',
            [discountId]
          );

          assert.equal(
            Number(result.rows[0].value),
            percentage
          );
        }
      });
    });

    await t.test('10. Reject unsupported 25 percent discount', async () => {
      await rollback(async () => {
        await assert.rejects(
          createDiscount(25),
          {
            code: '23514',
            constraint: 'kms_discount_policy',
          }
        );
      });
    });

    await t.test('11. Apply 10 percent monthly discount', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const discountId = await createDiscount(10);

        await assignDiscount(childId, discountId);

        const result = await calculate(childId);

        assert.deepEqual(result, {
          gross: 15000,
          personal: 1500,
          annual: 0,
          net: 13500,
        });
      });
    });

    await t.test('12. Combine 20 percent personal and annual discounts', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const discountId = await createDiscount(20);

        await assignDiscount(childId, discountId);

        const result = await calculate(childId, 12);

        assert.deepEqual(result, {
          gross: 180000,
          personal: 36000,
          annual: 17280,
          net: 126720,
        });
      });
    });

    await t.test('13. Reject inactive and future discounts', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const inactiveDiscount = await createDiscount(10, false);

        await assert.rejects(
          assignDiscount(childId, inactiveDiscount),
          /KMS_DISCOUNT_NOT_AVAILABLE/
        );
      });

      await rollback(async () => {
        const childId = await createChild();
        const futureDiscount = await createDiscount(20, true, 30);

        await assert.rejects(
          assignDiscount(childId, futureDiscount),
          /KMS_DISCOUNT_NOT_AVAILABLE/
        );
      });
    });

    await t.test('14. Reject invalid discount assignment', async () => {
      await rollback(async () => {
        const discountId = await createDiscount(10);

        await assert.rejects(
          assignDiscount(-1, discountId),
          /KMS_CHILD_NOT_FOUND/
        );
      });

      await rollback(async () => {
        const childId = await createChild();

        await assert.rejects(
          assignDiscount(childId, -1),
          /KMS_DISCOUNT_NOT_AVAILABLE/
        );
      });
    });

    await t.test('15. Replace existing active discount', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const first = await createDiscount(10);
        const second = await createDiscount(30);

        await assignDiscount(childId, first);
        await assignDiscount(childId, second);

        const active = await db.query(
          `SELECT discount_id
           FROM child_discounts
           WHERE child_id = $1
             AND revoked_at IS NULL`,
          [childId]
        );

        assert.equal(active.rows.length, 1);
        assert.equal(active.rows[0].discount_id, second);

        const old = await db.query(
          `SELECT revoked_at
           FROM child_discounts
           WHERE child_id = $1 AND discount_id = $2`,
          [childId, first]
        );

        assert.notEqual(old.rows[0].revoked_at, null);

        const result = await calculate(childId);

        assert.equal(result.personal, 4500);
        assert.equal(result.net, 10500);
      });
    });

    await t.test('16. Revoke active discount', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const discountId = await createDiscount(10);

        await assignDiscount(childId, discountId);

        await db.query(
          'SELECT kms_revoke_child_discount($1)',
          [childId]
        );

        const active = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM child_discounts
           WHERE child_id = $1 AND revoked_at IS NULL`,
          [childId]
        );

        assert.equal(active.rows[0].count, 0);

        const result = await calculate(childId);

        assert.equal(result.net, 15000);
      });
    });

    await t.test('17. Reject revocation without active discount', async () => {
      await rollback(async () => {
        const childId = await createChild();

        await assert.rejects(
          db.query(
            'SELECT kms_revoke_child_discount($1)',
            [childId]
          ),
          /KMS_ACTIVE_DISCOUNT_NOT_FOUND/
        );
      });
    });

    await t.test('18. Discount does not apply before assignment', async () => {
      await rollback(async () => {
        const childId = await createChild();
        const discountId = await createDiscount(10);

        await assignDiscount(childId, discountId);

        const result = await db.query(
          `SELECT * FROM kms_calculate_tuition(
            $1,
            (CURRENT_DATE - INTERVAL '1 day')::date,
            1
          )`,
          [childId]
        );

        assert.equal(
          Number(result.rows[0].personal_discount),
          0
        );

        assert.equal(
          Number(result.rows[0].net_amount),
          15000
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
