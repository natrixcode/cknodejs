
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import {
  createSession,
  revokeSession
} from '../../src/utils/sessions.js';

async function insertOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0].id;
}

async function main() {
  const database = await pool.query(
    'SELECT current_database() AS name'
  );

  if (!database.rows[0].name.startsWith('cknodejs_access_test_')) {
    throw new Error('Refusing to test against a non-test database');
  }

  let sequence = 0;

  async function employee(position) {
    const n = ++sequence;

    return insertOne(
      `INSERT INTO employees
         (first_name, last_name, phone, position, salary, status)
       VALUES ('Schedule', $1, $2, $3, 10000, 'active')
       RETURNING id`,
      [
        `Employee${n}`,
        `38050${String(n).padStart(7, '0')}`,
        position
      ]
    );
  }

  async function group() {
    const n = ++sequence;

    const roomId = await insertOne(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 10) RETURNING id`,
      [`Access Room ${n}`]
    );

    const groupId = await insertOne(
      `INSERT INTO groups
         (name, room_id, age_years, max_capacity)
       VALUES ($1, $2, 3, 10) RETURNING id`,
      [`Access Group ${n}`, roomId]
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

    await pool.query(
      'SELECT kms_activate_group($1)',
      [groupId]
    );

    return {
      groupId,
      roomId,
      educatorId,
      assistantId
    };
  }

  async function teacher() {
    const teacherId = await employee('teacher');

    const subjectId = await insertOne(
      `INSERT INTO subjects (name)
       VALUES ($1) RETURNING id`,
      [`Access Subject ${++sequence}`]
    );

    await pool.query(
      `INSERT INTO employee_subjects
         (employee_id, subject_id)
       VALUES ($1, $2)`,
      [teacherId, subjectId]
    );

    return { teacherId, subjectId };
  }

  async function lesson(
    g,
    t,
    status,
    start = '10:00',
    end = '11:00'
  ) {
    return insertOne(
      `INSERT INTO schedule
         (group_id, room_id, teacher_id, subject_id,
          start_time, end_time, status)
       VALUES (
         $1, $2, $3, $4,
         $5::timestamptz, $6::timestamptz, $7
       )
       RETURNING id`,
      [
        g.groupId,
        g.roomId,
        t.teacherId,
        t.subjectId,
        `2026-11-02 ${start}+02`,
        `2026-11-02 ${end}+02`,
        status
      ]
    );
  }

  const first = await group();
  const second = await group();

  const firstTeacher = await teacher();
  const secondTeacher = await teacher();

  const publishedId = await lesson(
    first,
    firstTeacher,
    'published'
  );

  const otherId = await lesson(
    second,
    secondTeacher,
    'published'
  );

  const draftId = await lesson(
    first,
    firstTeacher,
    'draft',
    '12:00',
    '13:00'
  );

  const parentId = await insertOne(
    `INSERT INTO parents (first_name, last_name, phone)
     VALUES ('Schedule', 'Parent', '+380990009901')
     RETURNING id`
  );

  const childId = await insertOne(
    `INSERT INTO children
       (first_name, last_name, date_of_birth, group_id)
     VALUES (
       'Schedule',
       'Child',
       CURRENT_DATE - INTERVAL '3 years',
       $1
     )
     RETURNING id`,
    [first.groupId]
  );

  await pool.query(
    `INSERT INTO children_parents (child_id, parent_id)
     VALUES ($1, $2)`,
    [childId, parentId]
  );

  async function user(
    username,
    role,
    parent = null,
    employeeId = null
  ) {
    return insertOne(
      `INSERT INTO users
         (username, password_hash, role, parent_id, employee_id)
       VALUES ($1, 'test-hash', $2, $3, $4)
       RETURNING id`,
      [username, role, parent, employeeId]
    );
  }

  const ids = {
    admin: await user(
      'schedule_access_admin',
      'admin'
    ),
    manager: await user(
      'schedule_access_manager',
      'manager'
    ),
    teacher: await user(
    'schedule_access_teacher',
    'employee',
    null,
    firstTeacher.teacherId
    ),
    educator: await user(
      'schedule_access_educator',
      'employee',
      null,
      first.educatorId
    ),
    assistant: await user(
      'schedule_access_assistant',
      'employee',
      null,
      first.assistantId
    ),
    parent: await user(
      'schedule_access_parent',
      'parent',
      parentId
    )
  };

  const tokens = Object.fromEntries(
    Object.entries(ids).map(([role, id]) => [
      role,
      createSession(id).token
    ])
  );

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();

      server.once('listening', resolve);
      server.once('error', reject);
    });

    const base =
      `http://127.0.0.1:${server.address().port}/api/v1`;

    const cases = [
      [
        'Admin can list schedules',
        'GET', '/schedule', 'admin', 200
      ],
      [
        'Manager can list schedules',
        'GET', '/schedule', 'manager', 200
      ],
      [
        'Parent cannot list schedules',
        'GET', '/schedule', 'parent', 403
      ],
      [
        'Teacher cannot list schedules',
        'GET', '/schedule', 'teacher', 403
      ],
      [
        'Educator cannot list schedules',
        'GET', '/schedule', 'educator', 403
      ],
      [
        'Assistant cannot list schedules',
        'GET', '/schedule', 'assistant', 403
      ],
      [
        'Admin can view any lesson',
        'GET', `/schedule/${otherId}`, 'admin', 200
      ],
      [
        'Manager can view any lesson',
        'GET', `/schedule/${otherId}`, 'manager', 200
      ],
      [
        'Teacher can view assigned lesson',
        'GET', `/schedule/${publishedId}`, 'teacher', 200
      ],
      [
        'Teacher cannot view another teacher lesson',
        'GET', `/schedule/${otherId}`, 'teacher', 403
      ],
      [
        'Educator can view own group lesson',
        'GET', `/schedule/${publishedId}`, 'educator', 200
      ],
      [
        'Educator cannot view another group lesson',
        'GET', `/schedule/${otherId}`, 'educator', 403
      ],
      [
        'Parent can view own published lesson',
        'GET', `/schedule/${publishedId}`, 'parent', 200
      ],
      [
        'Parent cannot view another group lesson',
        'GET', `/schedule/${otherId}`, 'parent', 403
      ],
      [
        'Parent cannot view draft lesson',
        'GET', `/schedule/${draftId}`, 'parent', 403
      ],
      [
        'Assistant cannot view lesson',
        'GET', `/schedule/${publishedId}`, 'assistant', 403
      ],
      [
        'Parent cannot edit lesson',
        'PATCH', `/schedule/${draftId}`, 'parent', 403
      ],
      [
        'Teacher cannot edit lesson',
        'PATCH', `/schedule/${draftId}`, 'teacher', 403
      ],
      [
        'Manager cannot publish lesson',
        'POST', '/schedule/publish', 'manager', 403
      ],
      [
        'Unauthenticated request is rejected',
        'GET', `/schedule/${publishedId}`, null, 401
      ]
    ];

    for (const [
      name,
      method,
      path,
      role,
      expected
    ] of cases) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: role
          ? { Authorization: `Bearer ${tokens[role]}` }
          : {}
      });

      assert.equal(
        response.status,
        expected,
        `${name}: expected ${expected}, got ${response.status}; ` +
          `body: ${await response.text()}`
      );

      console.log(`PASS: ${name}`);
    }
  } finally {
    for (const token of Object.values(tokens)) {
      revokeSession(token);
    }

    await new Promise((resolve, reject) => {
      server.close(
        error => error ? reject(error) : resolve()
      );
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
