
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleQuerySchema,
  scheduleOverviewQuerySchema
} from '../../src/validators/schedule_validator.js';

test('valid schedule filters', () => {
  assert.equal(scheduleQuerySchema.safeParse({
    date: '2026-11-19',
    group_id: '1',
    status: 'published'
  }).success, true);
});

test('invalid date range', () => {
  assert.equal(scheduleQuerySchema.safeParse({
    from: '2026-11-20',
    to: '2026-11-19'
  }).success, false);
});

test('overview requires group and date', () => {
  assert.equal(scheduleOverviewQuerySchema.safeParse({}).success, false);
  assert.equal(scheduleOverviewQuerySchema.safeParse({
    group_id: '1',
    date: '2026-11-19'
  }).success, true);
});

test('invalid group ID rejected', () => {
  assert.equal(scheduleOverviewQuerySchema.safeParse({
    group_id: '-1',
    date: '2026-11-19'
  }).success, false);
});
