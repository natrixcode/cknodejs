import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

test('Manual schedule API security and validation', async (t) => {
  await t.test('schedule requires authentication', async () => {
    const response = await request(app)
      .get('/api/v1/schedule');

    assert.equal(response.status, 401);
  });

  await t.test('daily blocks require authentication', async () => {
    const response = await request(app)
      .get('/api/v1/daily-blocks');

    assert.equal(response.status, 401);
  });

  await t.test('schedule creation requires authentication', async () => {
    const response = await request(app)
      .post('/api/v1/schedule')
      .send({});

    assert.equal(response.status, 401);
  });

  await t.test('daily block creation requires authentication', async () => {
    const response = await request(app)
      .post('/api/v1/daily-blocks')
      .send({});

    assert.equal(response.status, 401);
  });

  await t.test('schedule publication requires authentication', async () => {
    const response = await request(app)
      .post('/api/v1/schedule/publish')
      .send({ schedule_ids: [1], day_start: '08:00' });

    assert.equal(response.status, 401);
  });

  await t.test('schedule PATCH requires authentication', async () => {
    const response = await request(app)
      .patch('/api/v1/schedule/1')
      .send({ status: 'published' });

    assert.equal(response.status, 401);
  });

  await t.test('daily block DELETE requires authentication', async () => {
    const response = await request(app)
      .delete('/api/v1/daily-blocks/1');

    assert.equal(response.status, 401);
  });
});
