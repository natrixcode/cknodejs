import { ok, one, transaction } from './_common.js';

async function withActor(userId, work) {
  return transaction(async db => {
    await db.query(
      "SELECT set_config('kms.actor_user_id', $1, true)",
      [String(userId)]
    );

    return work(db);
  });
}

export async function markAttendance(userId, data) {
  return withActor(userId, async db => {
    const { result } = await one(
      `SELECT kms_mark_attendance(
        $1::bigint,
        $2::bigint,
        $3::date,
        $4::boolean,
        $5::text
      ) AS result`,
      [
        userId,
        data.child_id,
        data.date,
        data.present,
        data.reason ?? null
      ],
      db
    );

    return ok(result.record, result.created ? 201 : 200);
  });
}

export async function correctAttendance(userId, id, changes) {
  return withActor(userId, async db => {
    const { result } = await one(
      `SELECT kms_correct_attendance(
        $1::bigint,
        $2::bigint,
        $3::jsonb
      ) AS result`,
      [userId, id, JSON.stringify(changes)],
      db
    );

    return ok(result);
  });
}

export async function getGroupAttendance(userId, groupId, date) {
  const { result } = await one(
    `SELECT kms_group_attendance(
      $1::bigint,
      $2::bigint,
      $3::date
    ) AS result`,
    [userId, groupId, date]
  );

  return ok(result);
}