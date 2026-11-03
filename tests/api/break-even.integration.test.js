
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

// Контрольний сценарій: діти 3 років, 5 кімнат,
// 20 днів харчування, закупівля 200 грн/день,
// без знижки.
const SCENARIO = {
  age: 3,
  available_rooms: 5,
  meal_days: 20,
  food_cost_per_day: 200,
};

test('Break-even report HTTP integration (BUG-003)', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_break_even_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let db;
  let appPool;
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
        `break_even_admin_${randomUUID().slice(0, 8)}`,
        'test-hash',
        'admin',
      ]
    );

    // Створюємо сесію адміністратора.
    const adminToken = createSession(adminUser.rows[0].id).token;

    db = new Client({ database: dbName });
    await db.connect();

    // Усі запити до Break-even API авторизовані.
    const breakEven = (query) =>
      request(app)
        .get('/api/v1/reports/break-even')
        .set('Authorization', `Bearer ${adminToken}`)
        .query(query);

    await t.test('Returns minimal break-even configuration', async () => {
      const response = await breakEven(SCENARIO);

      assert.equal(response.status, 200);
      assert.equal(response.body.data.reachable, true);

      // 26 * (15000 + 20 * 400) = 598000;
      // 280000 + 2 * (2000 * 13 + 5000)
      // + 2 * (20000 + 3000) = 388000;
      // 26 * 20 * 200 = 104000;
      // 2 кімнати * 50000 = 100000.
      assert.deepEqual(response.body.data.break_even, {
        children_count: 26,
        group_count: 2,
        monthly_revenue: '598000.00',
        payroll_cost: '388000.00',
        food_procurement_cost: '104000.00',
        room_model_cost: '100000.00',
        modeled_profit: '6000.00',
      });
    });

    await t.test('One child fewer is still unprofitable', async () => {
      const { rows } = await db.query(
        `SELECT modeled_profit
         FROM kms_forecast_groups(3, 25, 2, 5, 20, 200, 0)`
      );

      assert.ok(Number(rows[0].modeled_profit) < 0);
    });

    await t.test('Discount moves break-even point higher', async () => {
      const response = await breakEven({
        ...SCENARIO,
        discount_percent: 10,
      });

      assert.equal(response.status, 200);
      assert.ok(
        response.body.data.break_even.children_count > 26
      );
    });

    await t.test('Reports when break-even is not reachable', async () => {
      const response = await breakEven({
        age: 3,
        available_rooms: 1,
        meal_days: 20,
        food_cost_per_day: 1200,
        discount_percent: 30,
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.data.reachable, false);
      assert.equal(response.body.data.break_even, null);
      assert.match(response.body.data.message, /недосяжна/);
    });

    await t.test('Rejects invalid parameters with 400', async () => {
      for (const query of [
        {},
        { ...SCENARIO, age: 6 },
        { ...SCENARIO, available_rooms: 0 },
        { ...SCENARIO, meal_days: 32 },
        { ...SCENARIO, food_cost_per_day: -1 },
        { ...SCENARIO, discount_percent: 31 },
        { ...SCENARIO, age: 'three' },
        { ...SCENARIO, currency: 'USD' },
        { ...SCENARIO, unknown: 1 },
      ]) {
        const response = await breakEven(query);

        assert.equal(
          response.status,
          400,
          JSON.stringify(query)
        );

        assert.equal(
          response.body.message,
          'Invalid break-even parameters'
        );
      }
    });

    await t.test('Is no longer a 501 stub', async () => {
      const response = await breakEven(SCENARIO);
      assert.notEqual(response.status, 501);
    });
  } finally {
    if (db) await db.end();
    if (appPool) await appPool.end();

    if (created) {
      await admin.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`
      );
    }

    if (connected) await admin.end();
  }
});
