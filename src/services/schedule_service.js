import {
  ok, fail, missing, unsupported,
  list, byId, patch, rows, one, transaction
} from './_common.js';

const fields = [
  'group_id',
  'subject_id',
  'teacher_id',
  'room_id',
  'start_time',
  'end_time',
  'status'
];

export const getSchedules = () =>
  list('schedule');

export const getScheduleById = id =>
  byId('schedule', id);

export async function createSchedule(data) {
  if (data.status !== 'draft') {
    return fail(
      422,
      'Створіть draft, тоді опублікуйте день через /publish'
    );
  }

  const item = await one(
    `SELECT * FROM kms_create_lesson(
      $1, $2, $3, $4, $5, $6
    )`,
    [
      data.group_id,
      data.subject_id ?? null,
      data.teacher_id,
      data.room_id,
      data.start_time,
      data.end_time
    ]
  );

  return ok(item, 201);
}

export async function updateSchedule(id, data) {
  if (
    Object.hasOwn(data, 'status') &&
    data.status === 'published'
  ) {
    return fail(
      422,
      'Публікація дозволена тільки через /publish'
    );
  }

  return patch(
    'schedule',
    id,
    data,
    fields.filter(field => field !== 'status')
  );
}

export async function deleteSchedule(id) {
  const removed = await one(
    `DELETE FROM schedule
     WHERE id = $1 AND status = $2
     RETURNING id`,
    [id, 'draft']
  );

  return removed
    ? { status: 204, noContent: true }
    : missing();
}

export const generateSchedule = () =>
  unsupported(
    'У міграціях немає SQL-функції генерації розкладу'
  );

export const validateSchedule = () =>
  unsupported(
    'У міграціях немає SQL-функції перевірки чернетки без збереження'
  );

export async function publishSchedule(data) {
  return transaction(async db => {
    const ids = data.schedule_ids.map(String);

    const selected = await rows(
      `SELECT
         id::text AS id,
         group_id::text AS group_id,
         to_char(
           (start_time AT TIME ZONE 'Europe/Kyiv')::date,
           'YYYY-MM-DD'
         ) AS day
       FROM schedule
       WHERE id = ANY($1::bigint[])
         AND status = 'draft'
       FOR UPDATE`,
      [ids],
      db
    );

    if (selected.length !== ids.length) {
      return fail(
        404,
        'Не всі заняття знайдено у статусі draft'
      );
    }

    const days = new Map();

    for (const s of selected) {
      days.set(`${s.group_id}:${s.day}`, {
        groupId: s.group_id,
        day: s.day
      });
    }

    for (const { groupId, day } of days.values()) {
      const all = await rows(
        `SELECT id::text AS id
         FROM schedule
         WHERE group_id = $1
           AND (
             start_time AT TIME ZONE 'Europe/Kyiv'
           )::date = $2
           AND status = 'draft'`,
        [groupId, day],
        db
      );

      if (all.some(s => !ids.includes(s.id))) {
        return fail(
          409,
          'Потрібно передати всі draft-заняття вибраного дня групи'
        );
      }
    }

    let count = 0;

    for (const { groupId, day } of days.values()) {
      const result = await one(
        `SELECT kms_publish_group_day(
          $1, $2
        ) AS count`,
        [groupId, day],
        db
      );

      count += result.count;
    }

    return ok({
      published: count,
      group_days: days.size
    });
  });
}