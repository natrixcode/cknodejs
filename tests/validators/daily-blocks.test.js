import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyBlockSchema,
  dailyBlockPatchSchema
} from '../../src/validators/daily_blocks_validator.js';

const validMeal = {
  group_id: 1,
  block_date: '2026-11-02',
  kind: 'meal',
  start_time: '2026-11-02T09:00:00+02:00',
  end_time: '2026-11-02T09:30:00+02:00'
};

const validNap = {
  group_id: 1,
  block_date: '2026-11-02',
  kind: 'nap',
  start_time: '2026-11-02T13:00:00+02:00',
  end_time: '2026-11-02T14:00:00+02:00'
};

test('accepts a valid 30-minute meal', () => {
  assert.equal(dailyBlockSchema.safeParse(validMeal).success, true);
});

test('accepts a valid 60-minute nap', () => {
  assert.equal(dailyBlockSchema.safeParse(validNap).success, true);
});

test('rejects a meal with an incorrect duration', () => {
  const result = dailyBlockSchema.safeParse({
    ...validMeal,
    end_time: '2026-11-02T09:20:00+02:00'
  });

  assert.equal(result.success, false);
});

test('rejects a nap with an incorrect duration', () => {
  const result = dailyBlockSchema.safeParse({
    ...validNap,
    end_time: '2026-11-02T13:30:00+02:00'
  });

  assert.equal(result.success, false);
});

test('rejects an end time earlier than start time', () => {
  const result = dailyBlockSchema.safeParse({
    ...validMeal,
    start_time: '2026-11-02T10:00:00+02:00',
    end_time: '2026-11-02T09:30:00+02:00'
  });

  assert.equal(result.success, false);
});

test('rejects a block with a different Kyiv date', () => {
  const result = dailyBlockSchema.safeParse({
    ...validMeal,
    block_date: '2026-11-03'
  });

  assert.equal(result.success, false);
});

test('rejects an empty PATCH body', () => {
  assert.equal(dailyBlockPatchSchema.safeParse({}).success, false);
});

test('rejects unknown fields', () => {
  const result = dailyBlockSchema.safeParse({
    ...validMeal,
    unexpected: true
  });

  assert.equal(result.success, false);
});
