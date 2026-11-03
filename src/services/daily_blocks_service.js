import {
  ok, fail, missing, list, byId, one, patch
} from './_common.js';

const fields = [
  'group_id',
  'block_date',
  'kind',
  'start_time',
  'end_time'
];

export const getDailyBlocks = () =>
  list('kms_daily_blocks');

export const getDailyBlockById = id =>
  byId('kms_daily_blocks', id);

export async function createDailyBlock(data) {
  const item = await one(
    `INSERT INTO kms_daily_blocks (
       group_id, block_date, kind, start_time, end_time
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.group_id,
      data.block_date,
      data.kind,
      data.start_time,
      data.end_time
    ]
  );

  return ok(item, 201);
}

export async function updateDailyBlock(id, data) {
  return patch('kms_daily_blocks', id, data, fields);
}

export async function deleteDailyBlock(id) {
  const removed = await one(
    `DELETE FROM kms_daily_blocks
     WHERE id = $1
     RETURNING id`,
    [id]
  );

  return removed
    ? { status: 204, noContent: true }
    : missing();
}
