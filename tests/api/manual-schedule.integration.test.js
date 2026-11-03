import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import request from 'supertest';

const exec = promisify(execFile);
const day = '2026-11-09';
const at = (time) => `${day}T${time}:00+02:00`;

test('Complete manual schedule HTTP scenario', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB',
  timeout: 120000
}, async (t) => {
  const dbName =
    `cknodejs_schedule_http_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB
  });

  let db;
  let pool;
  let connected = false;
  let created = false;
  let serial = 0;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await exec(process.execPath, ['src/database/migrate.js'], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000
    });

    process.env.PGDATABASE = dbName;

    const { default: app } = await import('../../src/app.js');
    const { pool: appPool } =
      await import('../../src/config/database.js');
    const { createSession } =
      await import('../../src/utils/sessions.js');

    pool = appPool;

    db = new Client({ database: dbName });
    await db.connect();

    const adminUser = await db.query(`
      INSERT INTO users (username, password_hash, role)
      VALUES ('schedule_http_admin', 'test-hash', 'admin')
      RETURNING id
    `);

    const token = createSession(adminUser.rows[0].id).token;
    assert.ok(token, 'Admin session token must exist');

    const api = (method, path, body) => {
      let call = request(app)[method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`);

      if (body !== undefined) call = call.send(body);
      return call;
    };

    const post = (path, body) => api('post', path, body);
    const put = (path, body) => api('put', path, body);
    const patch = (path, body) => api('patch', path, body);
    const get = (path) => api('get', path);
    const del = (path) => api('delete', path);

    const expectStatus = (response, status) => {
      assert.equal(
        response.status,
        status,
        JSON.stringify(response.body)
      );
      return response.body.data;
    };

    const numericId = (id) => {
      const value = Number(id);
      assert.ok(
        Number.isSafeInteger(value) && value > 0,
        `Invalid numeric ID: ${id}`
      );
      return value;
    };

    async function employee(position) {
      const n = ++serial;
      return expectStatus(await post('/employees', {
        first_name: 'Schedule',
        last_name: `Employee${n}`,
        email: `schedule${n}@example.test`,
        phone: `38050${String(n).padStart(7, '0')}`,
        position,
        salary: 10000,
        status: 'active'
      }), 201).id;
    }

    async function group() {
      const n = ++serial;

      const room = expectStatus(await post('/rooms', {
        name: `Schedule HTTP Room ${n}`,
        capacity: 10,
        status: 'available'
      }), 201);

      const g = expectStatus(await post('/groups', {
        name: `Schedule HTTP Group ${n}`,
        room_id: room.id,
        age_years: 3,
        max_capacity: 10
      }), 201);

      for (const role of ['educator', 'assistant']) {
        const staffId = await employee(role);

        expectStatus(await post(`/groups/${g.id}/employees`, {
          employee_id: staffId,
          role
        }), 201);
      }

      expectStatus(await patch(`/groups/${g.id}/status`, {
        status: 'active'
      }), 200);

      return { groupId: g.id, roomId: room.id };
    }

    async function blocks(groupId) {
      const result = [];

      for (const [kind, start, end] of [
        ['meal', '08:00', '08:30'],
        ['meal', '12:00', '12:30'],
        ['nap', '13:00', '14:00'],
        ['meal', '15:00', '15:30']
      ]) {
        const data = expectStatus(
          await post('/daily-blocks', {
            group_id: numericId(groupId),
            block_date: day,
            kind,
            start_time: at(start),
            end_time: at(end)
          }),
          201
        );

        result.push(data);
      }

      return result;
    }

    const first = await group();
    const second = await group();
    const teacherId = await employee('teacher');

    await t.test('Create subject and assign teacher', async () => {
      const subject = expectStatus(await post('/subjects', {
        name: 'Schedule HTTP Mathematics',
        description: 'Integration test subject'
      }), 201);

      t.subjectId = subject.id;

      const assigned = expectStatus(
        await put(`/subjects/${subject.id}/teachers`, {
          employee_ids: [numericId(teacherId)]
        }),
        200
      );

      assert.ok(
        assigned.some(e => String(e.id) === String(teacherId))
      );

      const teachers = expectStatus(
        await get(`/subjects/${subject.id}/teachers`),
        200
      );

      assert.ok(
        teachers.some(e => String(e.id) === String(teacherId))
      );
    });

    await t.test('Create lesson through API', async () => {
      const result = expectStatus(
        await post('/schedule', {
          group_id: numericId(first.groupId),
          room_id: numericId(first.roomId),
          teacher_id: numericId(teacherId),
          subject_id: numericId(t.subjectId),
          start_time: at('10:00'),
          end_time: at('11:00'),
          status: 'draft'
        }),
        201
      );

      const lesson = result.kms_create_lesson ?? result;
      assert.equal(lesson.status, 'draft');
      t.lessonId = lesson.id;

      const saved = expectStatus(
        await get(`/schedule/${t.lessonId}`),
        200
      );

      assert.equal(saved.status, 'draft');
    });

    await t.test('Cannot publish incomplete day', async () => {
      const response = await post('/schedule/publish', {
        schedule_ids: [t.lessonId],
        day_start: '08:00'
      });

      assert.equal(response.status, 422);
      assert.equal(
        response.body.message,
        'KMS_DAILY_ROUTINE_INCOMPLETE'
      );
    });

    await t.test('CRUD meal and nap on draft day', async () => {
      const block = expectStatus(
        await post('/daily-blocks', {
          group_id: numericId(first.groupId),
          block_date: day,
          kind: 'meal',
          start_time: at('08:00'),
          end_time: at('08:30')
        }),
        201
      );

      const found = expectStatus(
        await get(`/daily-blocks/${block.id}`),
        200
      );
      assert.equal(found.kind, 'meal');

      const updated = expectStatus(
        await patch(`/daily-blocks/${block.id}`, {
          start_time: at('08:30'),
          end_time: at('09:00')
        }),
        200
      );

      assert.equal(
        new Date(updated.start_time).toISOString(),
        new Date(at('08:30')).toISOString()
      );

      expectStatus(
        await del(`/daily-blocks/${block.id}`),
        204
      );
    });

    await t.test('Prepare full day and reject lesson conflict', async () => {
      t.blocks = await blocks(first.groupId);

      const conflicting = expectStatus(
        await post('/schedule', {
          group_id: numericId(first.groupId),
          room_id: numericId(first.roomId),
          teacher_id: numericId(teacherId),
          subject_id: numericId(t.subjectId),
          start_time: at('12:00'),
          end_time: at('12:30')
        }),
        201
      );

      const draft = conflicting.kms_create_lesson ?? conflicting;

      const rejected = await post('/schedule/publish', {
        schedule_ids: [t.lessonId, draft.id],
        day_start: '08:00'
      });

      assert.equal(rejected.status, 422);
      assert.equal(
        rejected.body.message,
        'KMS_LESSON_DAILY_BLOCK_CONFLICT'
      );

      expectStatus(await del(`/schedule/${draft.id}`), 204);
    });

    await t.test('Publish complete day at 08:00', async () => {
      const published = expectStatus(
        await post('/schedule/publish', {
          schedule_ids: [t.lessonId],
          day_start: '08:00'
        }),
        200
      );

      assert.equal(Number(published.published), 1);
      assert.equal(Number(published.group_days), 1);

      const lesson = expectStatus(
        await get(`/schedule/${t.lessonId}`),
        200
      );

      assert.equal(lesson.status, 'published');

      const window = await db.query(
        `SELECT day_start::text
         FROM kms_group_day_windows
         WHERE group_id=$1 AND block_date=$2`,
        [first.groupId, day]
      );

      assert.equal(window.rows[0].day_start, '08:00:00');
    });

    await t.test('Protect published daily routine', async () => {
      const meal = t.blocks[0];

      const rejected = await del(`/daily-blocks/${meal.id}`);
      assert.equal(rejected.status, 422);
      assert.equal(
        rejected.body.message,
        'KMS_DAILY_ROUTINE_INCOMPLETE'
      );

      const outside = await patch(
        `/daily-blocks/${t.blocks[3].id}`,
        {
          start_time: at('16:30'),
          end_time: at('17:00')
        }
      );

      assert.equal(outside.status, 422);
      assert.equal(
        outside.body.message,
        'KMS_BLOCK_OUTSIDE_WORKDAY'
      );

      const valid = expectStatus(
        await patch(`/daily-blocks/${t.blocks[3].id}`, {
          start_time: at('14:30'),
          end_time: at('15:00')
        }),
        200
      );

      assert.equal(valid.kind, 'meal');
    });

    await t.test('Reject overlapping teacher in second group', async () => {
      await blocks(second.groupId);

      const created = expectStatus(
        await post('/schedule', {
          group_id: numericId(second.groupId),
          room_id: numericId(second.roomId),
          teacher_id: numericId(teacherId),
          subject_id: numericId(t.subjectId),
          start_time: at('10:30'),
          end_time: at('11:30')
        }),
        201
      );

      const lesson = created.kms_create_lesson ?? created;

      const rejected = await post('/schedule/publish', {
        schedule_ids: [lesson.id],
        day_start: '08:00'
      });

      assert.equal(rejected.status, 422);

      const unchanged = expectStatus(
        await get(`/schedule/${lesson.id}`),
        200
      );

      assert.equal(unchanged.status, 'draft');
    });

    await t.test('Validate HTTP request bodies', async () => {
      const emptyPatch = await patch(
        `/schedule/${t.lessonId}`, {}
      );
      assert.equal(emptyPatch.status, 400);

      const invalidBlock = await post('/daily-blocks', {
        group_id: numericId(second.groupId),
        block_date: day,
        kind: 'nap',
        start_time: at('16:00'),
        end_time: at('16:30')
      });
      assert.equal(invalidBlock.status, 400);

      const invalidStart = await post('/schedule/publish', {
        schedule_ids: [t.lessonId],
        day_start: '25:00'
      });
      assert.equal(invalidStart.status, 400);
    });


    // EXTENDED_MANUAL_SCHEDULE_HTTP_TESTS

    const lessonPayload = (
      groupId,
      roomId,
      start,
      end,
      date = day
    ) => ({
      group_id: numericId(groupId),
      room_id: numericId(roomId),
      teacher_id: numericId(teacherId),
      subject_id: numericId(t.subjectId),
      start_time: `${date}T${start}:00+02:00`,
      end_time: `${date}T${end}:00+02:00`,
      status: 'draft'
    });

    const createDraft = async (payload) => {
      const response = await post('/schedule', payload);
      const data = expectStatus(response, 201);
      return data.kms_create_lesson ?? data;
    };

    const publishOne = (id, dayStart = '08:00') =>
      post('/schedule/publish', {
        schedule_ids: [id],
        day_start: dayStart
      });

    await t.test('HTTP: lesson conflicts with nap', async () => {
      const lesson = await createDraft(
        lessonPayload(
          first.groupId,
          first.roomId,
          '13:00',
          '14:00'
        )
      );

      const response = await publishOne(lesson.id);

      assert.equal(
        response.status,
        422,
        JSON.stringify(response.body)
      );

      const saved = expectStatus(
        await get(`/schedule/${lesson.id}`),
        200
      );

      assert.equal(saved.status, 'draft');

      assert.equal(
        (await del(`/schedule/${lesson.id}`)).status,
        204
      );
    });

    await t.test('HTTP: group overlap is rejected', async () => {
      const lesson = await createDraft(
        lessonPayload(
          first.groupId,
          second.roomId,
          '10:15',
          '10:45'
        )
      );

      const response = await publishOne(lesson.id);

      assert.equal(
        response.status,
        422,
        JSON.stringify(response.body)
      );

      assert.equal(
        (await del(`/schedule/${lesson.id}`)).status,
        204
      );
    });

    await t.test('HTTP: room overlap is rejected', async () => {
      const otherTeacher = await employee('teacher');

      expectStatus(
        await put(
          `/subjects/${t.subjectId}/teachers`,
          {
            employee_ids: [
              numericId(teacherId),
              numericId(otherTeacher)
            ]
          }
        ),
        200
      );

      const payload = lessonPayload(
        second.groupId,
        first.roomId,
        '10:15',
        '10:45'
      );

      payload.teacher_id = numericId(otherTeacher);

      const lesson = await createDraft(payload);
      const response = await publishOne(lesson.id);

      assert.equal(
        response.status,
        422,
        JSON.stringify(response.body)
      );

      assert.equal(
        (await del(`/schedule/${lesson.id}`)).status,
        204
      );
    });

await t.test(
  'HTTP: reject editing published lesson',
  async () => {
    const originalStart = at('10:00');
    const originalEnd = at('11:00');

    const response = await patch(
      `/schedule/${t.lessonId}`,
      {
        start_time: at('09:30'),
        end_time: at('10:30')
      }
    );

    assert.equal(
      response.status,
      400,
      JSON.stringify(response.body)
    );

    const unchanged = expectStatus(
      await get(`/schedule/${t.lessonId}`),
      200
    );

    assert.equal(unchanged.status, 'published');

    assert.equal(
      new Date(unchanged.start_time).toISOString(),
      new Date(originalStart).toISOString()
    );

    assert.equal(
      new Date(unchanged.end_time).toISOString(),
      new Date(originalEnd).toISOString()
    );
  }
);


    await t.test(
      'HTTP: move draft lesson to another date and group',
      async () => {
        const nextDay = '2026-11-10';

        const lesson = await createDraft(
          lessonPayload(
            second.groupId,
            second.roomId,
            '09:00',
            '10:00',
            nextDay
          )
        );

        const moved = expectStatus(
          await patch(`/schedule/${lesson.id}`, {
            group_id: numericId(first.groupId),
            room_id: numericId(first.roomId),
            start_time: '2026-11-11T09:00:00+02:00',
            end_time: '2026-11-11T10:00:00+02:00'
          }),
          200
        );

        assert.equal(
          String(moved.group_id),
          String(first.groupId)
        );

        assert.equal(
          new Date(moved.start_time).toISOString(),
          new Date('2026-11-11T09:00:00+02:00')
            .toISOString()
        );

        assert.equal(
          (await del(`/schedule/${lesson.id}`)).status,
          204
        );
      }
    );

    await t.test(
      'HTTP: full CRUD and transfer of nap block',
      async () => {
        const nap = expectStatus(
          await post('/daily-blocks', {
            group_id: numericId(second.groupId),
            block_date: '2026-11-10',
            kind: 'nap',
            start_time: '2026-11-10T13:00:00+02:00',
            end_time: '2026-11-10T14:00:00+02:00'
          }),
          201
        );

        const found = expectStatus(
          await get(`/daily-blocks/${nap.id}`),
          200
        );

        assert.equal(found.kind, 'nap');

        const updated = expectStatus(
          await patch(`/daily-blocks/${nap.id}`, {
            start_time: '2026-11-10T13:30:00+02:00',
            end_time: '2026-11-10T14:30:00+02:00'
          }),
          200
        );

        assert.equal(updated.kind, 'nap');

        const moved = expectStatus(
          await patch(`/daily-blocks/${nap.id}`, {
            group_id: numericId(first.groupId),
            block_date: '2026-11-11',
            start_time: '2026-11-11T13:00:00+02:00',
            end_time: '2026-11-11T14:00:00+02:00'
          }),
          200
        );

        assert.equal(
          String(moved.group_id),
          String(first.groupId)
        );

        assert.equal(
          (await del(`/daily-blocks/${nap.id}`)).status,
          204
        );

        assert.equal(
          (await get(`/daily-blocks/${nap.id}`)).status,
          404
        );
      }
    );

    await t.test(
      'HTTP: publish day at 09:00 and enforce 8 hours',
      async () => {
        const third = await group();
        const thirdTeacher = await employee('teacher');

        expectStatus(
          await put(
            `/subjects/${t.subjectId}/teachers`,
            {
              employee_ids: [
                numericId(teacherId),
                numericId(thirdTeacher)
              ]
            }
          ),
          200
        );

        const customDate = '2026-11-12';

        const customTime = (time) =>
          `${customDate}T${time}:00+02:00`;

        for (const [kind, start, end] of [
          ['meal', '09:00', '09:30'],
          ['meal', '13:00', '13:30'],
          ['nap', '14:00', '15:00'],
          ['meal', '16:00', '16:30']
        ]) {
          expectStatus(
            await post('/daily-blocks', {
              group_id: numericId(third.groupId),
              block_date: customDate,
              kind,
              start_time: customTime(start),
              end_time: customTime(end)
            }),
            201
          );
        }

        const payload = lessonPayload(
          third.groupId,
          third.roomId,
          '11:00',
          '12:00',
          customDate
        );

        payload.teacher_id = numericId(thirdTeacher);

        const lesson = await createDraft(payload);

        const published = expectStatus(
          await publishOne(lesson.id, '09:00'),
          200
        );

        assert.equal(Number(published.published), 1);

        const window = await db.query(
          `SELECT day_start::text
           FROM kms_group_day_windows
           WHERE group_id=$1 AND block_date=$2`,
          [third.groupId, customDate]
        );

        assert.equal(
          window.rows[0].day_start,
          '09:00:00'
        );

        const outside = await patch(
          `/schedule/${lesson.id}`,
          {
            start_time: customTime('17:30'),
            end_time: customTime('18:00')
          }
        );

       assert.equal(
       outside.status,
        400,
       JSON.stringify(outside.body)
      );
        const stillPublished = expectStatus(
          await get(`/schedule/${lesson.id}`),
          200
        );

        assert.equal(
          stillPublished.status,
          'published'
        );
      }
    );

    await t.test(
      'HTTP: Europe/Kyiv validation rejects cross-day block',
      async () => {
        const response = await post('/daily-blocks', {
          group_id: numericId(second.groupId),
          block_date: '2026-11-10',
          kind: 'nap',
          start_time: '2026-11-10T23:30:00+02:00',
          end_time: '2026-11-11T00:30:00+02:00'
        });

        assert.equal(
          response.status,
          400,
          JSON.stringify(response.body)
        );
      }
    );

    const persisted = await db.query(
      `SELECT status FROM schedule WHERE id=$1`,
      [t.lessonId]
    );

    assert.equal(persisted.rows[0].status, 'published');

  } finally {
    await db?.end();
    await pool?.end();

    if (created && connected) {
      await admin.query(
        `DROP DATABASE "${dbName}" WITH (FORCE)`
      );
    }

    if (connected) await admin.end();
  }
});
