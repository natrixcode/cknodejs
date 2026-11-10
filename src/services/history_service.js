import { ok, rows, one } from './_common.js';

export async function getRecordHistory(tableName, recordKey) {
  const result = await rows(
    'SELECT * FROM kms_get_record_history($1, $2)',
    [tableName, String(recordKey)]
  );

  return ok(result);
}

export async function getRecordStateAt(tableName, recordKey, timestamp) {
  const result = await one(
    'SELECT kms_get_record_state_at($1, $2, $3::timestamptz) AS state',
    [tableName, String(recordKey), timestamp]
  );

  return ok(result?.state ?? null);
}

