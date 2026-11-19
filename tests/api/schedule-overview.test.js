import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

test('overview requires authentication', async () => {
  const response = await request(app)
    .get('/api/v1/schedule/overview')
    .query({ group_id: '1', date: '2026-11-19' });

  assert.equal(response.status, 401);
});

test('overview rejects invalid bearer token', async () => {
  const response = await request(app)
    .get('/api/v1/schedule/overview')
    .query({ group_id: '1', date: '2026-11-19' })
    .set('Authorization', 'Bearer invalid-token');

  assert.equal(response.status, 401);
});
