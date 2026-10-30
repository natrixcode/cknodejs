import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import app from '../../src/app.js';

describe('Food and tuition calculation API', () => {
  describe('GET /api/v1/food/calculate', () => {
    it('calculates food cost with valid parameters', async () => {
      const response = await request(app)
        .get('/api/v1/food/calculate')
        .query({
          age_years: 2,
          days: 1,
          date: '2026-10-27'
        });

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'success');
    });

    it('returns 400 for invalid food parameters', async () => {
      const response = await request(app)
        .get('/api/v1/food/calculate')
        .query({
          age_years: 'invalid',
          days: 1,
          date: '2026-10-27'
        });

      assert.equal(response.status, 400);
      assert.equal(
        response.body.message,
        'Invalid food calculation parameters'
      );
    });
  });

  describe('GET /api/v1/tuition/calculate', () => {
    it('calculates tuition with valid parameters', async () => {
      const response = await request(app)
        .get('/api/v1/tuition/calculate')
        .query({
          date: '2026-10-27',
          currency: 'UAH',
          billing_period: 'monthly'
        });

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'success');
    });

    it('returns 400 for unsupported currency', async () => {
      const response = await request(app)
        .get('/api/v1/tuition/calculate')
        .query({
          date: '2026-10-27',
          currency: 'GBP',
          billing_period: 'monthly'
        });

      assert.equal(response.status, 400);
      assert.equal(
        response.body.message,
        'Invalid tuition calculation parameters'
      );
    });

    it('returns 422 when SQL calculation does not support EUR', async () => {
      const response = await request(app)
        .get('/api/v1/tuition/calculate')
        .query({
          date: '2026-10-27',
          currency: 'EUR',
          billing_period: 'monthly'
        });

      assert.equal(response.status, 422);
    });
  });
});