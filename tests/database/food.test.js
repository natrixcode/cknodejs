
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

test('Food and meal tariffs SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_food_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });

  let db;
  let connected = false;
  let created = false;

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

    async function value(sql, params = []) {
      const result = await db.query(sql, params);
      return Number(Object.values(result.rows[0])[0]);
    }

    async function createChild() {
      const result = await db.query(`
        INSERT INTO children (
          first_name, last_name, date_of_birth
        )
        VALUES (
          'Food', 'Test',
          (CURRENT_DATE - INTERVAL '3 years')::date
        )
        RETURNING id
      `);

      return result.rows[0].id;
    }

    await t.test('1. Default rates for ages 2-5', async () => {
      for (const [age, expected] of [
        [2, 300],
        [3, 400],
        [4, 500],
        [5, 600],
      ]) {
        const rate = await value(
          'SELECT kms_get_meal_rate($1, CURRENT_DATE)',
          [age]
        );

        assert.equal(rate, expected);
      }
    });

    await t.test('2. Historical tariff lookup', async () => {
      const rate = await value(
        `SELECT kms_get_meal_rate(3, DATE '2022-01-01')`
      );

      assert.equal(rate, 400);
    });

    await t.test('3. Calculate meal cost', async () => {
      const result = await value(
        'SELECT kms_calculate_meal_cost(3, 5)'
      );

      assert.equal(result, 2000);
    });

    await t.test('4. Zero meal days costs zero', async () => {
      const result = await value(
        'SELECT kms_calculate_meal_cost(3, 0)'
      );

      assert.equal(result, 0);
    });

    await t.test('5. Maximum 366 days is allowed', async () => {
      const result = await value(
        'SELECT kms_calculate_meal_cost(3, 366)'
      );

      assert.equal(result, 146400);
    });

    await t.test('6. Reject invalid age', async () => {
      for (const age of [1, 6, null]) {
        await rollback(async () => {
          await assert.rejects(
            db.query(
              'SELECT kms_get_meal_rate($1, CURRENT_DATE)',
              [age]
            ),
            /KMS_INVALID_MEAL_PARAMETERS/
          );
        });
      }
    });

    await t.test('7. Reject invalid days', async () => {
      for (const days of [-1, 367, null]) {
        await rollback(async () => {
          await assert.rejects(
            db.query(
              'SELECT kms_calculate_meal_cost(3, $1)',
              [days]
            ),
            /KMS_INVALID_MEAL_DAYS/
          );
        });
      }
    });

    await t.test('8. Reject missing date', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            'SELECT kms_get_meal_rate(3, NULL::date)'
          ),
          /KMS_INVALID_MEAL_PARAMETERS/
        );
      });
    });

    await t.test('9. Reject date before first tariff', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            `SELECT kms_get_meal_rate(
              3, DATE '2019-01-01'
            )`
          ),
          /KMS_MEAL_RATE_NOT_FOUND/
        );
      });
    });

    await t.test('10. Add new tariff and preserve history', async () => {
      await rollback(async () => {
        await db.query(
          `SELECT kms_set_meal_rate(
            3, 450, DATE '2025-01-01'
          )`
        );

        const oldRate = await value(
          `SELECT kms_get_meal_rate(
            3, DATE '2024-12-31'
          )`
        );

        const newRate = await value(
          `SELECT kms_get_meal_rate(
            3, DATE '2025-02-01'
          )`
        );

        assert.equal(oldRate, 400);
        assert.equal(newRate, 450);
      });
    });

    await t.test('11. Reject duplicate tariff date', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            `SELECT kms_set_meal_rate(
              3, 450, DATE '2020-01-01'
            )`
          ),
          { code: '23505' }
        );
      });
    });

    await t.test('12. Reject invalid new tariff', async () => {
      for (const params of [
        [1, 400, '2025-01-01'],
        [6, 400, '2025-01-01'],
        [3, -100, '2025-01-01'],
        [3, null, '2025-01-01'],
        [3, 400, null],
      ]) {
        await rollback(async () => {
          await assert.rejects(
            db.query(
              'SELECT kms_set_meal_rate($1, $2, $3::date)',
              params
            ),
            /KMS_INVALID_MEAL_RATE/
          );
        });
      }
    });

    await t.test('13. Calculate child meal cost', async () => {
      await rollback(async () => {
        const childId = await createChild();

        const result = await value(
          'SELECT kms_calculate_child_meal($1, 4)',
          [childId]
        );

        assert.equal(result, 1600);
      });
    });

    await t.test('14. Reject nonexistent child', async () => {
      await rollback(async () => {
        await assert.rejects(
          db.query(
            'SELECT kms_calculate_child_meal(-1, 5)'
          ),
          /KMS_CHILD_NOT_FOUND/
        );
      });
    });

    await t.test('15. Historical child age affects meal cost', async () => {
      await rollback(async () => {
        const childId = await createChild();

        const result = await value(
          `SELECT kms_calculate_child_meal(
            $1,
            3,
            (CURRENT_DATE - INTERVAL '1 year')::date
          )`,
          [childId]
        );

        // One year ago this child was 2 years old.
        // Meal rate: 300 per day, 3 days = 900.
        assert.equal(result, 900);
      });
    });

    await t.test('16. Decimal tariff rounds to cents', async () => {
      await rollback(async () => {
        await db.query(
          `SELECT kms_set_meal_rate(
            5, 12.345, DATE '2025-01-01'
          )`
        );

        // NUMERIC(10,2) stores 12.345 as 12.35.
        const result = await value(
          `SELECT kms_calculate_meal_cost(
            5, 3, DATE '2025-02-01'
          )`
        );

        assert.equal(result, 37.05);
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
