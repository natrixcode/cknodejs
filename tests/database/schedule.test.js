
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test('Schedule SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_schedule_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });

  let db;
  let adminConnected = false;
  let created = false;
  let counter = 0;

  const day = '2026-11-02';

  try {
    await admin.connect();
    adminConnected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    db = new Client({
      database: dbName,
      connectionTimeoutMillis: 3000,
    });
    await db.connect();

    async function rollback(action) {
      await db.query('BEGIN');
      try {
        await action();
      } finally {
        await db.query('ROLLBACK');
      }
    }

    async function employee(position, status = 'active') {
      const n = ++counter;

      const result = await db.query(
        `INSERT INTO employees
          (first_name, last_name, phone, position, salary, status)
         VALUES ('Test', $1, $2, $3, 10000, $4)
         RETURNING id`,
        [
          `Employee${n}`,
          `38050${String(n).padStart(7, '0')}`,
          position,
          status,
        ]
      );

      return result.rows[0].id;
    }

    async function group(active = true) {
      const n = ++counter;

      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, 10) RETURNING id`,
        [`Schedule Room ${n}`]
      );

      const roomId = room.rows[0].id;

      const result = await db.query(
        `INSERT INTO groups
           (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 10)
         RETURNING id`,
        [`Schedule Group ${n}`, roomId]
      );

      const groupId = result.rows[0].id;

      if (active) {
        for (const role of ['educator', 'assistant']) {
          const staffId = await employee(role);

          await db.query(
            'SELECT kms_assign_employee_to_group($1, $2, $3)',
            [groupId, staffId, role]
          );
        }

        await db.query(
          'SELECT kms_activate_group($1)',
          [groupId]
        );
      }

      return { groupId, roomId };
    }

    async function subject() {
      const n = ++counter;

      const result = await db.query(
        `INSERT INTO subjects (name)
         VALUES ($1) RETURNING id`,
        [`Subject ${n}`]
      );

      return result.rows[0].id;
    }

    async function teacherWithSubject() {
      const teacherId = await employee('teacher');
      const subjectId = await subject();

      await db.query(
        `INSERT INTO employee_subjects
           (employee_id, subject_id)
         VALUES ($1, $2)`,
        [teacherId, subjectId]
      );

      return { teacherId, subjectId };
    }

    async function lesson({
      groupId,
      roomId,
      teacherId,
      subjectId = null,
      start = '10:00',
      end = '11:00',
      status = 'draft',
    }) {
      return db.query(
        `INSERT INTO schedule
           (group_id, room_id, teacher_id, subject_id,
            start_time, end_time, status)
         VALUES (
           $1, $2, $3, $4,
           $5::timestamptz,
           $6::timestamptz,
           $7
         )
         RETURNING id, status`,
        [
          groupId,
          roomId,
          teacherId,
          subjectId,
          `${day} ${start}+02`,
          `${day} ${end}+02`,
          status,
        ]
      );
    }

    await t.test('1. Create draft lesson', async () => {
      await rollback(async () => {
        const g = await group(false);
        const teacher = await teacherWithSubject();

        const result = await db.query(
          `SELECT (
            kms_create_lesson(
              $1, $2, $3, $4,
              $5::timestamptz,
              $6::timestamptz
            )
          ).status AS status`,
          [
            g.groupId,
            teacher.subjectId,
            teacher.teacherId,
            g.roomId,
            `${day} 10:00+02`,
            `${day} 11:00+02`,
          ]
        );

        assert.equal(result.rows[0].status, 'draft');
      });
    });

    await t.test('2. Reject non-teacher employee', async () => {
      await rollback(async () => {
        const g = await group(false);
        const assistantId = await employee('assistant');

        await assert.rejects(
          lesson({
            ...g,
            teacherId: assistantId,
          }),
          /KMS_INVALID_TEACHER/
        );
      });
    });

    await t.test('3. Reject inactive teacher', async () => {
      await rollback(async () => {
        const g = await group(false);
        const teacherId = await employee('teacher', 'inactive');

        await assert.rejects(
          lesson({
            ...g,
            teacherId,
          }),
          /KMS_INVALID_TEACHER/
        );
      });
    });

    await t.test('4. Reject teacher subject mismatch', async () => {
      await rollback(async () => {
        const g = await group(false);
        const teacherId = await employee('teacher');
        const subjectId = await subject();

        await assert.rejects(
          lesson({
            ...g,
            teacherId,
            subjectId,
          }),
          /KMS_TEACHER_SUBJECT_MISMATCH/
        );
      });
    });

    await t.test('5. Reject publishing for inactive group', async () => {
      await rollback(async () => {
        const g = await group(false);
        const teacher = await teacherWithSubject();

        await assert.rejects(
          lesson({
            ...g,
            ...teacher,
            status: 'published',
          }),
          /KMS_GROUP_NOT_ACTIVE/
        );
      });
    });

    await t.test('6. Reject published lesson without subject', async () => {
      await rollback(async () => {
        const g = await group();
        const teacherId = await employee('teacher');

        await assert.rejects(
          lesson({
            ...g,
            teacherId,
            status: 'published',
          }),
          /KMS_SUBJECT_REQUIRED/
        );
      });
    });

    await t.test('7. Reject teacher schedule overlap', async () => {
      await rollback(async () => {
        const first = await group();
        const second = await group();
        const teacher = await teacherWithSubject();

        await lesson({
          ...first,
          ...teacher,
          status: 'published',
        });

        await assert.rejects(
          lesson({
            ...second,
            ...teacher,
            start: '10:30',
            end: '11:30',
            status: 'published',
          }),
          {
            code: '23P01',
            constraint: 'kms_teacher_no_overlap',
          }
        );
      });
    });

    await t.test('8. Reject group schedule overlap', async () => {
      await rollback(async () => {
        const g = await group();
        const firstTeacher = await teacherWithSubject();
        const secondTeacher = await teacherWithSubject();

        await lesson({
          ...g,
          ...firstTeacher,
          status: 'published',
        });

        await assert.rejects(
          lesson({
            ...g,
            ...secondTeacher,
            start: '10:30',
            end: '11:30',
            status: 'published',
          }),
          { code: '23P01' }
        );
      });
    });

    await t.test('9. Reject room schedule overlap', async () => {
      await rollback(async () => {
        const first = await group();
        const second = await group();
        const firstTeacher = await teacherWithSubject();
        const secondTeacher = await teacherWithSubject();

        await lesson({
          ...first,
          ...firstTeacher,
          status: 'published',
        });

        // Two different groups try to use the same room.
        await assert.rejects(
          lesson({
            groupId: second.groupId,
            roomId: first.roomId,
            ...secondTeacher,
            start: '10:30',
            end: '11:30',
            status: 'published',
          }),
          {
            code: '23P01',
            constraint: 'kms_room_no_overlap',
          }
        );
      });
    });

    await t.test('10. Overlapping drafts are allowed', async () => {
      await rollback(async () => {
        const g = await group(false);
        const teacher = await teacherWithSubject();

        await lesson({ ...g, ...teacher });

        await lesson({
          ...g,
          ...teacher,
          start: '10:30',
          end: '11:30',
        });

        const result = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM schedule WHERE group_id = $1`,
          [g.groupId]
        );

        assert.equal(result.rows[0].count, 2);
      });
    });

    await t.test('11. Back-to-back published lessons are allowed', async () => {
      await rollback(async () => {
        const g = await group();
        const teacher = await teacherWithSubject();

        await lesson({
          ...g,
          ...teacher,
          start: '10:00',
          end: '11:00',
          status: 'published',
        });

        const result = await lesson({
          ...g,
          ...teacher,
          start: '11:00',
          end: '12:00',
          status: 'published',
        });

        assert.equal(result.rows[0].status, 'published');
      });
    });

    await t.test('12. Reject lesson and meal conflict', async () => {
      await rollback(async () => {
        const g = await group();
        const teacher = await teacherWithSubject();

        await lesson({
          ...g,
          ...teacher,
          status: 'published',
        });

        await assert.rejects(
          db.query(
            `INSERT INTO kms_daily_blocks
               (group_id, block_date, kind, start_time, end_time)
             VALUES (
               $1, $2::date, 'meal',
               $3::timestamptz, $4::timestamptz
             )`,
            [
              g.groupId,
              day,
              `${day} 10:00+02`,
              `${day} 10:30+02`,
            ]
          ),
          /KMS_BLOCK_LESSON_CONFLICT/
        );
      });

      await rollback(async () => {
        const g = await group();
        const teacher = await teacherWithSubject();

        await db.query(
          `INSERT INTO kms_daily_blocks
             (group_id, block_date, kind, start_time, end_time)
           VALUES (
             $1, $2::date, 'meal',
             $3::timestamptz, $4::timestamptz
           )`,
          [
            g.groupId,
            day,
            `${day} 10:00+02`,
            `${day} 10:30+02`,
          ]
        );

        await assert.rejects(
          lesson({
            ...g,
            ...teacher,
            start: '10:15',
            end: '10:45',
            status: 'published',
          }),
          /KMS_LESSON_DAILY_BLOCK_CONFLICT/
        );
      });
    });

    await t.test('13. Reject consecutive meals', async () => {
      await rollback(async () => {
        const g = await group(false);

        const addMeal = (start, end) =>
          db.query(
            `INSERT INTO kms_daily_blocks
               (group_id, block_date, kind, start_time, end_time)
             VALUES (
               $1, $2::date, 'meal',
               $3::timestamptz, $4::timestamptz
             )`,
            [
              g.groupId,
              day,
              `${day} ${start}+02`,
              `${day} ${end}+02`,
            ]
          );

        await addMeal('08:00', '08:30');

        await assert.rejects(
          addMeal('08:30', '09:00'),
          /KMS_CONSECUTIVE_MEALS/
        );
      });
    });

    await t.test('14. Check age schedule balance', async () => {
      await rollback(async () => {
        const first = await group();
        const second = await group();
        const firstTeacher = await teacherWithSubject();
        const secondTeacher = await teacherWithSubject();

        const balanced = async () => {
          const result = await db.query(
            `SELECT kms_check_age_schedule_balance(
               $1::date, 3
             ) AS balanced`,
            [day]
          );
          return result.rows[0].balanced;
        };

        assert.equal(await balanced(), true);

        await lesson({
          ...first,
          ...firstTeacher,
          status: 'published',
        });

        assert.equal(await balanced(), false);

        await lesson({
          ...second,
          ...secondTeacher,
          status: 'published',
        });

        assert.equal(await balanced(), true);
      });
    });

  } finally {
    try {
      await db?.end();
    } finally {
      try {
        if (created) {
          await admin.query(
            `DROP DATABASE "${dbName}" WITH (FORCE)`
          );
        }
      } finally {
        if (adminConnected) {
          await admin.end();
        }
      }
    }
  }
});
