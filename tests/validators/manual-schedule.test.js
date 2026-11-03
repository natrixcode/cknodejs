import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSchema } from '../../src/validators/schedule_validator.js';
import {
  dailyBlockSchema,
  dailyBlockPatchSchema
} from '../../src/validators/daily_blocks_validator.js';

test('valid draft lesson', () => {
  const result = scheduleSchema.safeParse({
    group_id: 1,
    subject_id: 1,
    teacher_id: 1,
    room_id: 1,
    start_time: '2026-11-10T09:00:00+02:00',
    end_time: '2026-11-10T09:30:00+02:00'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.status, 'draft');
});

test('reject invalid lesson interval', () => {
  const result = scheduleSchema.safeParse({
    group_id: 1,
    subject_id: 1,
    teacher_id: 1,
    room_id: 1,
    start_time: '2026-11-10T10:00:00+02:00',
    end_time: '2026-11-10T09:00:00+02:00'
  });

  assert.equal(result.success, false);
});

test('reject published lesson without subject', () => {
  const result = scheduleSchema.safeParse({
    group_id: 1,
    teacher_id: 1,
    room_id: 1,
    start_time: '2026-11-10T09:00:00+02:00',
    end_time: '2026-11-10T09:30:00+02:00',
    status: 'published'
  });

  assert.equal(result.success, false);
});

test('accept meal block in Europe/Kyiv', () => {
  const result = dailyBlockSchema.safeParse({
    group_id: 1,
    block_date: '2026-11-10',
    kind: 'meal',
    start_time: '2026-11-10T12:00:00+02:00',
    end_time: '2026-11-10T12:30:00+02:00'
  });

  assert.equal(result.success, true);
});

test('accept nap block in Europe/Kyiv', () => {
  const result = dailyBlockSchema.safeParse({
    group_id: 1,
    block_date: '2026-11-10',
    kind: 'nap',
    start_time: '2026-11-10T13:00:00+02:00',
    end_time: '2026-11-10T14:00:00+02:00'
  });

  assert.equal(result.success, true);
});

test('reject empty daily block PATCH', () => {
  assert.equal(
    dailyBlockPatchSchema.safeParse({}).success,
    false
  );
});

test('reject invalid meal duration', () => {
  const result = dailyBlockSchema.safeParse({
    group_id: 1,
    block_date: '2026-11-10',
    kind: 'meal',
    start_time: '2026-11-10T12:00:00+02:00',
    end_time: '2026-11-10T13:00:00+02:00'
  });

  assert.equal(result.success, false);
});
