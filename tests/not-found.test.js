import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import app from '../src/app.js';

test('unknown route returns JSON 404', async () => {
  const response = await request(app).get('/api/v1/unknown-route');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { message: 'Маршрут не знайдено' });
});
