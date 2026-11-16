import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import {
  createSession,
  revokeSession
} from '../../src/utils/sessions.js';

// Issue #73: GET /api/v1/schedule filtered by teacher_id and room_id.

async function insertOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0].id;
}

async function main() {
  const database = await pool.query(
    'SELECT current_database() AS name'
  );

  if (!database.rows[0].name.startsWith('cknodejs_schedule_filter_test_')) {
    throw new Error('Refusing to test against a non-test database');
  }

  let sequence = 0;
  const day = '2026-11-02';

  async function employee(position) {
    const n = ++sequence;

    return insertOne(
      `INSERT INTO employees
         (first_name, last_name, phone, position, salary, status)
       VALUES ('Filter', $1, $2, $3, 10000, 'active')
       RETURNING id`,
      [
        `Employee${n}`,
        `38067${String(n).padStart(7, '0')}`,
        position
      ]
    );
  }

  async function group() {
    const n = ++sequence;

    const roomId = await insertOne(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 10) RETURNING id`,
      [`Filter Room ${n}`]
    );

    const groupId = await insertOne(
      `INSERT INTO groups
         (name, room_id, age_years, max_capacity)
       VALUES ($1, $2, 3, 10) RETURNING id`,
      [`Filter Group ${n}`, roomId]
    );

    const educatorId = await employee('educator');
    const assistantId = await employee('assistant');

    for (const [id, role] of [
      [educatorId, 'educator'],
      [assistantId, 'assistant']
    ]) {
      await pool.query(
        'SELECT kms_assign_employee_to_group($1,$2,$3)',
        [groupId, id, role]
      );
    }

    await pool.query('SELECT kms_activate_group($1)', [groupId]);

    const blocks = [
      ['meal', '08:00', '08:30'],
      ['meal', '12:00', '12:30'],
      ['nap', '13:00', '14:00'],
      ['meal', '15:00', '15:30']
    ];

    for (const [kind, start, end] of blocks) {
      await pool.query(
        `INSERT INTO kms_daily_blocks
           (group_id, block_date, kind, start_time, end_time)
         VALUES ($1, $2::date, $3, $4::timestamptz, $5::timestamptz)`,
        [groupId, day, kind, `${day} ${start}+02`, `${day} ${end}+02`]
      );
    }

    return { groupId, roomId, educatorId, assistantId };
  }

  async function teacher() {
    const teacherId = await employee('teacher');

    const subjectId = await insertOne(
      `INSERT INTO subjects (name) VALUES ($1) RETURNING id`,
      [`Filter Subject ${++sequence}`]
    );

    await pool.query(
      `INSERT INTO employee_subjects (employee_id, subject_id)
       VALUES ($1, $2)`,
      [teacherId, subjectId]
    );

    return { teacherId, subjectId };
  }

  async function lesson(g, t, start, end) {
    return insertOne(
      `INSERT INTO schedule
         (group_id, room_id, teacher_id, subject_id,
          start_time, end_time, status)
       VALUES ($1, $2, $3, $4,
               $5::timestamptz, $6::timestamptz, 'draft')
       RETURNING id`,
      [
        g.groupId,
        g.roomId,
        t.teacherId,
        t.subjectId,
        `${day} ${start}+02`,
        `${day} ${end}+02`
      ]
    );
  }

  const first = await group();
  const second = await group();
  const firstTeacher = await teacher();
  const secondTeacher = await teacher();

  // First teacher works in both groups (two rooms);
  // second teacher works only in the second group.
  const firstGroupLesson = await lesson(first, firstTeacher, '10:00', '10:30');
  const firstTeacherSecondRoom =
    await lesson(second, firstTeacher, '11:00', '11:30');
  const secondTeacherLesson =
    await lesson(second, secondTeacher, '10:00', '10:30');

  const parentId = await insertOne(
    `INSERT INTO parents (first_name, last_name, phone)
     VALUES ('Filter', 'Parent', '+380990007701') RETURNING id`
  );

  async function user(username, role, parent = null, employeeId = null) {
    return insertOne(
      `INSERT INTO users
         (username, password_hash, role, parent_id, employee_id)
       VALUES ($1, 'test-hash', $2, $3, $4) RETURNING id`,
      [username, role, parent, employeeId]
    );
  }

  const ids = {
    admin: await user('filter_admin', 'admin'),
    manager: await user('filter_manager', 'manager'),
    teacher: await user('filter_teacher', 'employee', null, firstTeacher.teacherId),
    educator: await user('filter_educator', 'employee', null, first.educatorId),
    assistant: await user('filter_assistant', 'employee', null, first.assistantId),
    parent: await user('filter_parent', 'parent', parentId)
  };

  const tokens = Object.fromEntries(
    Object.entries(ids).map(([role, id]) => [role, createSession(id).token])
  );

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const t1 = firstTeacher.teacherId;
    const t2 = secondTeacher.teacherId;
    const room2 = second.roomId;

    // [name, role, query, expected status, expected lesson ids | null]
    const cases = [
      ['Admin lists all lessons', 'admin', '',
        200, [firstGroupLesson, secondTeacherLesson, firstTeacherSecondRoom]],
      ['Admin filters by teacher', 'admin', `?teacher_id=${t1}`,
        200, [firstGroupLesson, firstTeacherSecondRoom]],
      ['Admin filters by room', 'admin', `?room_id=${room2}`,
        200, [secondTeacherLesson, firstTeacherSecondRoom]],
      ['Admin filters by teacher and room', 'admin',
        `?teacher_id=${t1}&room_id=${room2}`, 200, [firstTeacherSecondRoom]],
      ['Manager filters by any teacher', 'manager', `?teacher_id=${t2}`,
        200, [secondTeacherLesson]],
      ['Unknown teacher returns empty list', 'admin', '?teacher_id=999999',
        200, []],
      ['Teacher sees own lessons', 'teacher', '',
        200, [firstGroupLesson, firstTeacherSecondRoom]],
      ['Teacher filters by own teacher_id', 'teacher', `?teacher_id=${t1}`,
        200, [firstGroupLesson, firstTeacherSecondRoom]],
      ['Teacher filters own lessons by room', 'teacher', `?room_id=${room2}`,
        200, [firstTeacherSecondRoom]],
      ['Teacher cannot request another teacher', 'teacher', `?teacher_id=${t2}`,
        403, null],
      ['Educator sees own group only', 'educator', '',
        200, [firstGroupLesson]],
      ['Educator filter stays within own group', 'educator', `?teacher_id=${t2}`,
        200, []],
      ['Assistant cannot list schedule', 'assistant', '', 403, null],
      ['Parent cannot list schedule', 'parent', '', 403, null],
      ['Invalid teacher_id returns 400', 'admin', '?teacher_id=abc', 400, null],
      ['Unknown query parameter returns 400', 'admin', '?teacher=1', 400, null],
      ['Unauthenticated request is rejected', null, '', 401, null]
    ];

    for (const [name, role, query, expectedStatus, expectedIds] of cases) {
      const response = await fetch(`${base}/schedule${query}`, {
        headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {}
      });
      const text = await response.text();

      assert.equal(
        response.status,
        expectedStatus,
        `${name}: expected ${expectedStatus}, got ${response.status}; body: ${text}`
      );

      if (expectedIds) {
        const body = JSON.parse(text);
        const actual = body.data.map(lessonRow => Number(lessonRow.id));

        assert.deepEqual(
          actual,
          expectedIds.map(Number),
          `${name}: wrong lessons; body: ${text}`
        );
      }

      if (name === 'Teacher cannot request another teacher') {
        assert.equal(JSON.parse(text).message, 'KMS_SCHEDULE_FORBIDDEN');
      }

      console.log(`PASS: ${name}`);
    }
  } finally {
    for (const token of Object.values(tokens)) {
      revokeSession(token);
    }

    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
