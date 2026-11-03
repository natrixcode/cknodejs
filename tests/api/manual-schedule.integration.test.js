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

      assert.equal(response.status, 409);
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

      assert.equal(rejected.status, 409);
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
      assert.equal(rejected.status, 409);
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

      assert.equal(outside.status, 409);
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

      assert.equal(rejected.status, 409);

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
