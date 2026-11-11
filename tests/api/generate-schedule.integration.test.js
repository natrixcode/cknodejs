import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import request from 'supertest';
import { hashPassword } from '../../src/utils/password.js';

const exec = promisify(execFile);
const day = '2026-01-01';

test('Issue #51: real PostgreSQL generation and authenticated HTTP', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB && 'Set MIGRATION_TEST_ADMIN_DB',
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_generate_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ database: process.env.MIGRATION_TEST_ADMIN_DB });
  const originalDatabase = process.env.PGDATABASE;
  let created = false;
  let db;
  let pool;
  let serial = 0;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;
    await exec(process.execPath, ['src/database/migrate.js'], {
      env: { ...process.env, PGDATABASE: dbName }, timeout: 30000,
    });
    db = new Client({ database: dbName });
    await db.connect();
    const id = async (sql, args = []) => (await db.query(sql, args)).rows[0].id;
    const employee = (position = 'teacher') => id(
      `INSERT INTO employees (first_name, last_name, phone, position, salary)
       VALUES ('Generate', 'Test', $1, $2, 10000) RETURNING id`,
      [`51${String(++serial).padStart(9, '0')}`, position],
    );
    async function group() {
      const n = ++serial;
      const roomId = await id('INSERT INTO rooms (name, capacity) VALUES ($1, 10) RETURNING id', [`Generate room ${n}`]);
      const groupId = await id(`INSERT INTO groups (name, room_id, age_years, max_capacity)
        VALUES ($1, $2, 3, 10) RETURNING id`, [`Generate group ${n}`, roomId]);
      for (const role of ['educator', 'assistant']) {
        await db.query('SELECT kms_assign_employee_to_group($1, $2, $3)', [groupId, await employee(role), role]);
      }
      await db.query('SELECT kms_activate_group($1)', [groupId]);
      return { groupId, roomId };
    }
    async function blocks(groupId, date = day, shift = 0) {
      for (const [kind, start, end] of [
        ['meal', '08:00', '08:30'], ['meal', '12:00', '12:30'],
        ['nap', '13:00', '14:00'], ['meal', '15:00', '15:30'],
      ]) {
        await db.query(`INSERT INTO kms_daily_blocks (group_id, block_date, kind, start_time, end_time)
          VALUES ($1, $2, $3,
            (($2::date + $4::time) AT TIME ZONE 'Europe/Kyiv') + $6 * INTERVAL '1 hour',
            (($2::date + $5::time) AT TIME ZONE 'Europe/Kyiv') + $6 * INTERVAL '1 hour')`,
        [groupId, date, kind, start, end, shift]);
      }
    }
    const subjects = [];
    const teachers = [];
    for (let i = 0; i < 5; i++) {
      subjects.push(await id('INSERT INTO subjects (name) VALUES ($1) RETURNING id', [`Subject ${i}`]));
      teachers.push(await employee());
      await db.query('INSERT INTO employee_subjects VALUES ($1, $2)', [teachers[i], subjects[i]]);
    }
    const generate = async (g, date = day, connection = db) =>
      (await connection.query('SELECT * FROM kms_generate_group_day($1, $2::date)', [g.groupId, date])).rows;
    const signature = rows => rows.map(({ subject_id, teacher_id, room_id, start_time, end_time, status }) =>
      ({ subject_id, teacher_id, room_id, start_time, end_time, status }));
    const subjectIds = rows => rows.map(row => row.subject_id);
    const count = async g => Number((await db.query('SELECT count(*) FROM schedule WHERE group_id=$1', [g.groupId])).rows[0].count);
    async function error(action, message) {
      await db.query('SAVEPOINT expected_failure');
      try {
        await assert.rejects(action, { code: 'P0001', message });
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_failure');
        await db.query('RELEASE SAVEPOINT expected_failure');
      }
    }
    async function sqlTest(name, work) {
      await t.test(name, async () => {
        await db.query('BEGIN');
        try { await work(); } finally { await db.query('ROLLBACK'); }
      });
    }
    async function obstacle(g, room, teacher, start = '08:00', end = '16:00', date = day) {
      await db.query(`SELECT kms_create_lesson($1, NULL, $2, $3,
        ($4::date + $5::time) AT TIME ZONE 'Europe/Kyiv',
        ($4::date + $6::time) AT TIME ZONE 'Europe/Kyiv')`,
      [g.groupId, teacher, room, date, start, end]);
    }

    await sqlTest('three distinct 30-minute drafts fit the routine and publish', async () => {
      const g = await group();
      await blocks(g.groupId);
      const lessons = await generate(g);
      assert.deepEqual(subjectIds(lessons), subjects.slice(0, 3));
      assert.equal(lessons.length, 3);
      for (const lesson of lessons) {
        assert.equal(lesson.status, 'draft');
        assert.equal(lesson.room_id, g.roomId);
        assert.equal(lesson.end_time - lesson.start_time, 30 * 60_000);
        assert.equal((await db.query(`SELECT kms_validate_lesson_draft($1,$2,$3,$4,$5,$6,$7) AS valid`,
          [g.groupId, lesson.teacher_id, g.roomId, lesson.start_time, lesson.end_time, lesson.id, lesson.subject_id])).rows[0].valid, true);
      }
      assert.equal((await db.query('SELECT kms_publish_group_day($1,$2) AS count', [g.groupId, day])).rows[0].count, 3);
    });

    await sqlTest('calendar cycle includes skipped days and normalizes negative modulo', async () => {
      const g = await group();
      for (const [date, expected] of [
        ['2025-12-31', [2, 3, 4]], [day, [0, 1, 2]],
        ['2026-01-02', [3, 4, 0]], ['2026-01-04', [4, 0, 1]],
      ]) {
        await blocks(g.groupId, date);
        assert.deepEqual(subjectIds(await generate(g, date)), expected.map(i => subjects[i]));
      }
    });

    await sqlTest('date order, deletion and manual edits of another day do not affect generation', async () => {
      const g = await group();
      const later = '2026-01-04';
      await blocks(g.groupId, day);
      await blocks(g.groupId, later);
      const laterFirst = signature(await generate(g, later));
      const earlierSecond = signature(await generate(g));
      await db.query('DELETE FROM schedule WHERE group_id=$1', [g.groupId]);
      const earlierFirst = await generate(g);
      assert.deepEqual(signature(earlierFirst), earlierSecond);
      assert.deepEqual(signature(await generate(g, later)), laterFirst);
      await db.query('UPDATE schedule SET subject_id=$1, teacher_id=$2 WHERE id=$3',
        [subjects[4], teachers[4], earlierFirst[0].id]);
      await db.query("DELETE FROM schedule WHERE group_id=$1 AND (start_time AT TIME ZONE 'Europe/Kyiv')::date=$2", [g.groupId, later]);
      assert.deepEqual(signature(await generate(g, later)), laterFirst);
      await db.query('DELETE FROM schedule WHERE group_id=$1', [g.groupId]);
      assert.deepEqual(signature(await generate(g, later)), laterFirst);
    });

    await sqlTest('saved workday and Kyiv summer offset are respected', async () => {
      const g = await group();
      const date = '2026-07-01';
      await blocks(g.groupId, date, 1);
      await db.query("INSERT INTO kms_group_day_windows VALUES ($1,$2,'09:00')", [g.groupId, date]);
      const lessons = await generate(g, date);
      assert.equal(lessons[0].start_time.toISOString(), '2026-07-01T06:30:00.000Z');
      assert.equal((await db.query("SELECT kms_publish_group_day($1,$2,'09:00') AS count", [g.groupId, date])).rows[0].count, 3);
    });

    await sqlTest('missing routine, insufficient subjects, and invalid SQL input leave no rows', async () => {
      const g = await group();
      await error(() => generate(g), 'KMS_DAILY_ROUTINE_INCOMPLETE');
      await blocks(g.groupId);
      await db.query('DELETE FROM subjects WHERE id = ANY($1::bigint[])', [subjects.slice(2)]);
      await error(() => generate(g), 'KMS_GENERATION_INSUFFICIENT_SUBJECTS');
      await error(() => generate(g, null), 'KMS_GENERATION_INVALID_PARAMETERS');
      assert.equal(await count(g), 0);
    });

    await sqlTest('unqualified or inactive teachers cannot cause subject substitution or partial results', async () => {
      const g = await group();
      await blocks(g.groupId);
      await db.query('DELETE FROM employee_subjects WHERE subject_id=$1', [subjects[2]]);
      await error(() => generate(g), 'KMS_GENERATION_NO_AVAILABLE_TEACHER');
      assert.equal(await count(g), 0);
      await db.query('INSERT INTO employee_subjects VALUES ($1,$2)', [teachers[2], subjects[2]]);
      await db.query("UPDATE employees SET status='inactive' WHERE id=$1", [teachers[2]]);
      await error(() => generate(g), 'KMS_GENERATION_NO_AVAILABLE_TEACHER');
      assert.equal(await count(g), 0);
    });

    await sqlTest('draft teacher occupancy is respected and a free qualified alternative is used', async () => {
      const g = await group();
      const other = await group();
      await blocks(g.groupId);
      await obstacle(other, other.roomId, teachers[0]);
      await error(() => generate(g), 'KMS_GENERATION_NO_AVAILABLE_TEACHER');
      const alternative = await employee();
      await db.query('INSERT INTO employee_subjects VALUES ($1,$2)', [alternative, subjects[0]]);
      assert.equal((await generate(g))[0].teacher_id, alternative);
    });

    await sqlTest('room occupied by another group draft causes 422 business error without rows', async () => {
      const g = await group();
      const other = await group();
      await blocks(g.groupId);
      await obstacle(other, g.roomId, teachers[4]);
      await error(() => generate(g), 'KMS_GENERATION_ROOM_CONFLICT');
      assert.equal(await count(g), 0);
    });

    await sqlTest('not enough remaining free time rolls back the entire plan', async () => {
      const g = await group();
      const other = await group();
      await blocks(g.groupId);
      await obstacle(other, other.roomId, teachers[0], '08:00', '15:30');
      await error(() => generate(g), 'KMS_GENERATION_NO_FREE_WINDOW');
      assert.equal(await count(g), 0);
    });

    await sqlTest('arbitrary obstacle boundaries and published occupancy are respected', async () => {
      const g = await group();
      const other = await group();
      await blocks(g.groupId);
      await blocks(other.groupId);
      await obstacle(other, g.roomId, teachers[0], '08:30', '09:07');
      await db.query('UPDATE schedule SET subject_id=$1 WHERE group_id=$2', [subjects[0], other.groupId]);
      await db.query('SELECT kms_publish_group_day($1,$2)', [other.groupId, day]);
      const lessons = await generate(g);
      assert.equal(lessons[0].start_time.toISOString(), '2026-01-01T07:07:00.000Z');
      await db.query('SELECT kms_publish_group_day($1,$2)', [g.groupId, day]);
    });

    await sqlTest('existing draft or published day is unchanged', async () => {
      const g = await group();
      await blocks(g.groupId);
      const lessons = await generate(g);
      await error(() => generate(g), 'KMS_GENERATION_DAY_EXISTS');
      assert.deepEqual((await db.query('SELECT * FROM schedule WHERE group_id=$1 ORDER BY start_time', [g.groupId])).rows, lessons);
      await db.query('SELECT kms_publish_group_day($1,$2)', [g.groupId, day]);
      await error(() => generate(g), 'KMS_GENERATION_DAY_EXISTS');
      assert.equal(await count(g), 3);
    });

    await sqlTest('failure while inserting the third lesson rolls back the first two', async () => {
      const g = await group();
      await blocks(g.groupId);
      await db.query(`CREATE FUNCTION test_fail_third() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.subject_id = ${subjects[2]} THEN RAISE EXCEPTION 'TEST_THIRD_LESSON'; END IF;
        RETURN NEW; END; $$;
        CREATE TRIGGER test_fail_third BEFORE INSERT ON schedule FOR EACH ROW EXECUTE FUNCTION test_fail_third()`);
      await error(() => generate(g), 'TEST_THIRD_LESSON');
      assert.equal(await count(g), 0);
    });

    await t.test('parallel same-group and different-group requests serialize without conflicts', async () => {
      const g = await group();
      const other = await group();
      const concurrentDay = '2026-02-01';
      await blocks(g.groupId, concurrentDay);
      await blocks(other.groupId, concurrentDay);
      const a = new Client({ database: dbName, application_name: 'generate-test-a' });
      const b = new Client({ database: dbName, application_name: 'generate-test-b' });
      try {
        await a.connect();
        await b.connect();
        // Force both callers to queue on the same lock before releasing it.
        await db.query('BEGIN');
        await db.query('SELECT pg_advisory_xact_lock(2026,1005)');
        const calls = Promise.allSettled([generate(g, concurrentDay, a), generate(g, concurrentDay, b)]);
        try {
          const deadline = Date.now() + 10000;
          let waiting = 0;
          do {
            waiting = (await db.query(`SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname=current_database() AND application_name IN ('generate-test-a','generate-test-b')
                AND wait_event='advisory'`)).rows[0].count;
            if (waiting === 2) break;
            // Statistics snapshots are cached within a transaction.
            await db.query('SELECT pg_stat_clear_snapshot()');
            await delay(25);
          } while (Date.now() < deadline);
          assert.equal(waiting, 2, 'Both generation requests must wait for the shared lock');
        } finally {
          await db.query('COMMIT');
        }
        const results = await calls;
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.message, 'KMS_GENERATION_DAY_EXISTS');
        assert.equal(await count(g), 3);
        const nextDay = '2026-02-02';
        await blocks(g.groupId, nextDay);
        await blocks(other.groupId, nextDay);
        const pair = await Promise.all([generate(g, nextDay, a), generate(other, nextDay, b)]);
        assert.equal(pair.flat().length, 6);
        const conflicts = await db.query(`SELECT a.id FROM schedule a JOIN schedule b ON a.id < b.id
          AND a.start_time < b.end_time AND a.end_time > b.start_time
          AND (a.teacher_id=b.teacher_id OR a.room_id=b.room_id OR a.group_id=b.group_id)`);
        assert.equal(conflicts.rowCount, 0);
        await db.query('SELECT kms_publish_group_day($1,$2)', [g.groupId, nextDay]);
        await db.query('SELECT kms_publish_group_day($1,$2)', [other.groupId, nextDay]);
      } finally {
        await a.end();
        await b.end();
      }
    });

    process.env.PGDATABASE = dbName;
    const { default: app } = await import('../../src/app.js');
    ({ pool } = await import('../../src/config/database.js'));
    const password = randomUUID();
    const hash = await hashPassword(password);
    async function login(role, position) {
      const username = `generate_actor_${++serial}`;
      let employeeId = null;
      let parentId = null;
      if (position) employeeId = await employee(position);
      if (role === 'parent') parentId = await id(`INSERT INTO parents (first_name,last_name,phone)
        VALUES ('Test','Parent',$1) RETURNING id`, [`parent${serial}`]);
      await db.query(`INSERT INTO users (username,password_hash,role,employee_id,parent_id)
        VALUES ($1,$2,$3,$4,$5)`, [username, hash, role, employeeId, parentId]);
      const response = await request(app).post('/api/v1/auth/login').send({ username, password });
      assert.equal(response.status, 200);
      assert.ok(response.body.data.token);
      return response.body.data.token;
    }
    const adminToken = await login('admin');
    const managerToken = await login('manager');
    const post = (path, body, token = managerToken) => request(app).post(`/api/v1/schedule/${path}`)
      .set('Authorization', `Bearer ${token}`).send(body);
    const g = await group();
    const httpDay = '2026-03-01';
    await blocks(g.groupId, httpDay);
    const payload = { group_id: Number(g.groupId), date: httpDay };

    await t.test('HTTP real login: manager generates, views and validates; only admin publishes', async () => {
      const response = await post('generate', payload);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.status, 'success');
      assert.equal(response.body.data.length, 3);
      for (const lesson of response.body.data) {
        const read = await request(app).get(`/api/v1/schedule/${lesson.id}`).set('Authorization', `Bearer ${managerToken}`);
        assert.equal(read.status, 200);
        assert.equal(read.body.data.status, 'draft');
        const valid = await post('validate', {
          group_id: Number(g.groupId), teacher_id: Number(lesson.teacher_id), room_id: Number(g.roomId),
          start_time: lesson.start_time, end_time: lesson.end_time, exclude_id: lesson.id,
          subject_id: Number(lesson.subject_id),
        });
        assert.equal(valid.status, 200, JSON.stringify(valid.body));
        assert.deepEqual(valid.body.data, { valid: true });
      }
      const publish = { schedule_ids: response.body.data.map(row => row.id) };
      assert.equal((await post('publish', publish)).status, 403);
      const published = await post('publish', publish, adminToken);
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.equal(published.body.data.published, 3);
      for (const lesson of response.body.data) {
        const read = await request(app).get(`/api/v1/schedule/${lesson.id}`).set('Authorization', `Bearer ${managerToken}`);
        assert.equal(read.body.data.status, 'published');
      }
      const repeat = await post('generate', payload);
      assert.equal(repeat.status, 422);
      assert.deepEqual(repeat.body, { message: 'KMS_GENERATION_DAY_EXISTS' });
    });

    await t.test('HTTP forbidden roles, anonymous requests and invalid parameters', async () => {
      for (const [role, position] of [
        ['parent'],
        ['employee', 'teacher'],
        ['employee', 'educator'],
        ['employee', 'assistant'],
        ['employee', 'director'],
        ['employee', 'cook'],
        ['employee', 'nurse'],
        ['employee', 'accountant']
      ]) {
        const token = await login(role, position);
      
        assert.equal(
          (await post('generate', payload, token)).status,
          403,
          `${role}/${position}`
        );
      }
      for (const bad of [{}, { ...payload, group_id: -1 }, { ...payload, group_id: Number.MAX_SAFE_INTEGER + 1 },
        { ...payload, date: '2026-02-30' }, { ...payload, date: '0000-01-01' },
        { ...payload, date: 'not-date' }, { ...payload, extra: true }]) {
        assert.equal((await post('generate', bad)).status, 400);
      }
    });

    await t.test('HTTP new business failures are 422 and validation is read-only', async () => {
      const missingRoutine = await post('generate', { ...payload, date: '2026-03-02' });
      assert.equal(missingRoutine.status, 422);
      assert.deepEqual(missingRoutine.body, { message: 'KMS_DAILY_ROUTINE_INCOMPLETE' });
      const date = '2026-01-01';
      await blocks(g.groupId, date);
      await db.query('DELETE FROM employee_subjects WHERE subject_id=$1', [subjects[2]]);
      const noTeacher = await post('generate', { ...payload, date });
      assert.equal(noTeacher.status, 422);
      assert.deepEqual(noTeacher.body, { message: 'KMS_GENERATION_NO_AVAILABLE_TEACHER' });
      await db.query('INSERT INTO employee_subjects VALUES ($1,$2)', [teachers[2], subjects[2]]);
      const validPayload = { group_id: Number(g.groupId), teacher_id: Number(teachers[0]), room_id: Number(g.roomId),
        start_time: `${date}T09:00:00+02:00`, end_time: `${date}T09:30:00+02:00` };
      const before = await count(g);
      assert.equal((await post('validate', validPayload)).status, 200);
      assert.equal(await count(g), before);
      assert.equal((await post('validate', { ...validPayload,
        start_time: `${date}T08:00:00+02:00`, end_time: `${date}T08:30:00+02:00` })).status, 422);
      assert.equal((await post('validate', { ...validPayload, exclude_id: '9223372036854775807' })).status, 422);
      const generated = await post('generate', { ...payload, date }, adminToken);
      assert.equal(generated.status, 201);
      assert.equal((await post('validate', validPayload)).status, 422);
    });

    await t.test('HTTP parallel generation returns one 201 and one 422', async () => {
      const date = '2026-03-04';
      await blocks(g.groupId, date);
      const responses = await Promise.all([
        post('generate', { ...payload, date }),
        post('generate', { ...payload, date }, adminToken),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 422]);
      assert.equal(responses.find(response => response.status === 422).body.message, 'KMS_GENERATION_DAY_EXISTS');
      const result = await db.query(`SELECT count(*)::int AS count FROM schedule WHERE group_id=$1
        AND (start_time AT TIME ZONE 'Europe/Kyiv')::date=$2`, [g.groupId, date]);
      assert.equal(result.rows[0].count, 3);
    });
  } finally {
    await db?.end();
    await pool?.end();
    if (originalDatabase === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = originalDatabase;
    if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
});
