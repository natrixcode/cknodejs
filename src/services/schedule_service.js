import { pool } from '../config/database.js';
import { scheduleSchema } from '../validators/schedule_validator.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, group_id, subject_id, teacher_id, room_id,
  start_time, end_time, status, created_at
`;

const fields = [
  'group_id',
  'subject_id',
  'teacher_id',
  'room_id',
  'start_time',
  'end_time',
  'status'
];

async function findConflicts(client, data, excludedId = null) {
  const result = await client.query(
    `SELECT id, group_id, teacher_id, room_id,
            start_time, end_time
     FROM schedule
     WHERE start_time < $2::timestamptz
       AND end_time > $1::timestamptz
       AND ($3::bigint IS NULL OR id <> $3)
       AND (
         group_id = $4
         OR teacher_id = $5
         OR room_id = $6
       )
     ORDER BY start_time, id`,
    [
      data.start_time,
      data.end_time,
      excludedId,
      data.group_id,
      data.teacher_id,
      data.room_id
    ]
  );

  return result.rows;
}

function normalizeSchedule(row, changes = {}) {
  return {
    group_id: row.group_id,
    subject_id: row.subject_id,
    teacher_id: row.teacher_id,
    room_id: row.room_id,
    start_time: row.start_time.toISOString(),
    end_time: row.end_time.toISOString(),
    status: row.status,
    ...changes
  };
}

export async function getSchedules() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM schedule
       ORDER BY start_time ASC, id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getScheduleById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid schedule ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM schedule
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Schedule entry not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createSchedule(data) {
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(741201)');

    const conflicts = await findConflicts(client, data);

    if (conflicts.length > 0) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Schedule conflict detected',
        conflicts
      } };
    }

    const {
      group_id,
      subject_id = null,
      teacher_id,
      room_id,
      start_time,
      end_time,
      status = 'draft'
    } = data;

    const result = await client.query(
      `INSERT INTO schedule (
        group_id, subject_id, teacher_id, room_id,
        start_time, end_time, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${columns}`,
      [
        group_id,
        subject_id,
        teacher_id,
        room_id,
        start_time,
        end_time,
        status
      ]
    );

    await client.query('COMMIT');

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    throw error;
  } finally {
    client?.release();
  }
}

export async function updateSchedule(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid schedule ID'
    } };
  }

  const changedFields = Object.keys(data ?? {});

  if (
    changedFields.length === 0 ||
    changedFields.some(field => !fields.includes(field))
  ) {
    return { status: 400, body: {
      message: 'Invalid update fields'
    } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(741201)');

    const existing = await client.query(
      `SELECT ${columns}
       FROM schedule
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Schedule entry not found'
      } };
    }

    const merged = normalizeSchedule(existing.rows[0], data);
    const parsed = scheduleSchema.safeParse(merged);

    if (!parsed.success) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Invalid schedule data',
        errors: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      } };
    }

    const conflicts = await findConflicts(client, parsed.data, id);

    if (conflicts.length > 0) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Schedule conflict detected',
        conflicts
      } };
    }

    const setClause = changedFields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = changedFields.map(field => parsed.data[field]);

    const result = await client.query(
      `UPDATE schedule
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING ${columns}`,
      [...values, id]
    );

    await client.query('COMMIT');

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    throw error;
  } finally {
    client?.release();
  }
}

export async function deleteSchedule(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid schedule ID'
      } };
    }

    const result = await pool.query(
      `DELETE FROM schedule
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Schedule entry not found'
      } };
    }

    return { status: 204, noContent: true };
  } catch (error) {
    throw error;
  }
}

export async function generateSchedule() {
  return { status: 501, body: {
    message: 'Automatic schedule generation is not implemented'
  } };
}

export async function validateSchedule(data) {
  try {
    const conflicts = await findConflicts(
      pool,
      data,
      data.exclude_id ?? null
    );

    return { status: 200, body: {
      valid: conflicts.length === 0,
      conflicts
    } };
  } catch (error) {
    throw error;
  }
}

export async function publishSchedule(data) {
  const { schedule_ids } = data;

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(741201)');

    const result = await client.query(
      `SELECT ${columns}
       FROM schedule
       WHERE id = ANY($1::bigint[])
       ORDER BY id
       FOR UPDATE`,
      [schedule_ids]
    );

    if (result.rows.length !== schedule_ids.length) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'One or more schedule entries not found'
      } };
    }

    for (const row of result.rows) {
      if (row.subject_id === null) {
        await client.query('ROLLBACK');

        return { status: 400, body: {
          message: 'Published entries must have a subject',
          schedule_id: row.id
        } };
      }

      const conflicts = await findConflicts(
        client,
        row,
        row.id
      );

      if (conflicts.length > 0) {
        await client.query('ROLLBACK');

        return { status: 409, body: {
          message: 'Schedule conflict detected',
          schedule_id: row.id,
          conflicts
        } };
      }
    }

    const updated = await client.query(
      `UPDATE schedule
       SET status = 'published'
       WHERE id = ANY($1::bigint[])
       RETURNING ${columns}`,
      [schedule_ids]
    );

    await client.query('COMMIT');

    return { status: 200, body: 
      updated.rows.sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 :
        BigInt(a.id) > BigInt(b.id) ? 1 : 0
      )
     };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    throw error;
  } finally {
    client?.release();
  }
}
