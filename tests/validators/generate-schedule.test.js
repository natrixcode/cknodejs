import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { generateScheduleSchema } from '../../src/validators/schedule_validator.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

test('generation parameters accept real calendar dates and reject unsafe input', () => {
  assert.ok(generateScheduleSchema.safeParse({ group_id: 1, date: '2024-02-29' }).success);
  for (const body of [
    {}, { group_id: 0, date: '2026-01-01' }, { group_id: '1', date: '2026-01-01' },
    { group_id: Number.MAX_SAFE_INTEGER + 1, date: '2026-01-01' },
    { group_id: 1, date: '0000-01-01' }, { group_id: 1, date: '2026-02-29' },
    { group_id: 1, date: '2026-01-01T00:00:00Z' },
    { group_id: 1, date: '2026-01-01', status: 'published' },
  ]) assert.equal(generateScheduleSchema.safeParse(body).success, false);
});

// Middleware unit test only; integration tests execute the real SQL functions.
for (const message of [
  'KMS_GENERATION_INVALID_PARAMETERS', 'KMS_GENERATION_DAY_EXISTS',
  'KMS_GENERATION_INSUFFICIENT_SUBJECTS', 'KMS_GENERATION_NO_AVAILABLE_TEACHER',
  'KMS_GENERATION_NO_FREE_WINDOW', 'KMS_GENERATION_ROOM_CONFLICT',
  'KMS_SCHEDULE_GROUP_CONFLICT', 'KMS_SCHEDULE_ROOM_CONFLICT',
  'KMS_SCHEDULE_TEACHER_CONFLICT', 'KMS_SCHEDULE_ROOM_UNAVAILABLE',
  'KMS_SCHEDULE_INVALID_INTERVAL', 'KMS_SCHEDULE_INVALID_EXCLUDE',
]) {
  test(`${message} maps to a safe HTTP 422`, async () => {
    const app = express();
    app.get('/api/v1/schedule/test', (req, res, next) => next({
      code: 'P0001', message, detail: 'private SQL details', stack: 'private stack',
    }));
    app.use(errorHandler);
    const response = await request(app).get('/api/v1/schedule/test');
    assert.equal(response.status, 422);
    assert.deepEqual(response.body, { message });
  });
}
