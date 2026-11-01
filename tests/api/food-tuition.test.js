
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test('Food and tuition calculation API integration', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_api_test_${randomUUID().replaceAll('-', '')}`;

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

    // Окреме підключення для перевірки тестової БД.
    db = new Client({ database: dbName });
    await db.connect();

    await t.test('Food calculation', async (t) => {
      await t.test('calculates food cost and returns expected amount', async () => {
        const response = await request(app)
          .get('/api/v1/food/calculate')
          .query({
            age_years: 2,
            days: 1,
            date: '2026-10-27',
          });

        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'success');
        assert.equal(Number(response.body.data.amount), 300);
      });

      await t.test('returns 400 for invalid food parameters', async () => {
        const response = await request(app)
          .get('/api/v1/food/calculate')
          .query({
            age_years: 'invalid',
            days: 1,
            date: '2026-10-27',
          });

        assert.equal(response.status, 400);
        assert.equal(
          response.body.message,
          'Invalid food calculation parameters'
        );
      });
    });

    await t.test('Tuition calculation', async (t) => {
      await t.test('calculates tuition and returns expected amount', async () => {
        const response = await request(app)
          .get('/api/v1/tuition/calculate')
          .query({
            date: '2026-10-27',
            currency: 'UAH',
            billing_period: 'monthly',
          });

        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'success');
        assert.equal(Number(response.body.data.amount), 15000);
      });

      await t.test('returns 400 for unsupported currency', async () => {
        const response = await request(app)
          .get('/api/v1/tuition/calculate')
          .query({
            date: '2026-10-27',
            currency: 'GBP',
            billing_period: 'monthly',
          });

        assert.equal(response.status, 400);
        assert.equal(
          response.body.message,
          'Invalid tuition calculation parameters'
        );
      });

      await t.test('returns 422 when SQL calculation does not support EUR', async () => {
        const response = await request(app)
          .get('/api/v1/tuition/calculate')
          .query({
            date: '2026-10-27',
            currency: 'EUR',
            billing_period: 'monthly',
          });

        assert.equal(response.status, 422);
      });
    });
  } finally {
    await appPool?.end();
    await db?.end();

    if (created && connected) {
      await admin.query(
        `DROP DATABASE "${dbName}" WITH (FORCE)`
      );
    }

    if (connected) {
      await admin.end();
    }
  }
});
