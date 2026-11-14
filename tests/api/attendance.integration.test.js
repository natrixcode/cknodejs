
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import request from 'supertest';
import { hashPassword } from '../../src/utils/password.js';

const exec = promisify(execFile);

test('Issue #53: attendance SQL and HTTP', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000
}, async t => {
  const databaseName =
    `cknodejs_attendance_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB
  });

  const originalDatabase = process.env.PGDATABASE;

  let db;
  let pool;
  let created = false;
  let connected = false;
  let serial = 0;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;

    await exec(process.execPath, ['src/database/migrate.js'], {
      env: {
        ...process.env,
        PGDATABASE: databaseName
      },
      timeout: 30000
    });

    process.env.PGDATABASE = databaseName;

    const { default: app } = await import('../../src/app.js');
    ({ pool } = await import('../../src/config/database.js'));

    db = new Client({ database: databaseName });
    await db.connect();

    const id = async (sql, values = []) =>
      (await db.query(sql, values)).rows[0].id;

    const result = async (sql, values = []) =>
      (await db.query(sql, values)).rows[0].result;

    const {
      today,
      yesterday,
      tomorrow,
      month
    } = (await db.query(`
      SELECT
        to_char(kms_attendance_today(), 'YYYY-MM-DD') AS today,
        to_char(kms_attendance_today() - 1, 'YYYY-MM-DD') AS yesterday,
        to_char(kms_attendance_today() + 1, 'YYYY-MM-DD') AS tomorrow,
        to_char(
          date_trunc('month', kms_attendance_today()),
          'YYYY-MM-DD'
        ) AS month
    `)).rows[0];

    async function group() {
      const n = ++serial;

      const roomId = await id(
        `INSERT INTO rooms(name, capacity)
         VALUES ($1, 10)
         RETURNING id`,
        [`Attendance room ${n}`]
      );

      return id(
        `INSERT INTO groups(name, room_id, age_years, max_capacity)
         VALUES ($1, $2, 3, 10)
         RETURNING id`,
        [`Attendance group ${n}`, roomId]
      );
    }

    async function employee(position) {
      const n = ++serial;

      return id(
        `INSERT INTO employees(
          first_name, last_name, phone, position, salary
        )
        VALUES ('Attendance', $1, $2, $3, 10000)
        RETURNING id`,
        [
          `Employee ${n}`,
          `+38097${String(n).padStart(7, '0')}`,
          position
        ]
      );
    }

    async function child(groupId) {
      return id(
        `INSERT INTO children(
          first_name, last_name, date_of_birth, group_id
        )
        VALUES (
          'Attendance',
          $1,
          (CURRENT_DATE - INTERVAL '3 years 3 months')::date,
          $2
        )
        RETURNING id`,
        [`Child ${++serial}`, groupId]
      );
    }

    const password = 'Attendance-Test-Password-53';
    const passwordHash = await hashPassword(password);

    async function user(role, employeeId = null, parentId = null) {
      const username = `attendance_user_${++serial}`;

      const userId = await id(
        `INSERT INTO users(
          username, password_hash, role, employee_id, parent_id
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
        [username, passwordHash, role, employeeId, parentId]
      );

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username, password });

      assert.equal(response.status, 200, JSON.stringify(response.body));

      return {
        id: userId,
        token: response.body.data.token
      };
    }

    const groupA = await group();
    const groupB = await group();

    const educatorEmployee = await employee('educator');
    const assistantEmployee = await employee('assistant');
    const teacherEmployee = await employee('teacher');
    const legacyTeacherEmployee = await employee('teacher');

    await db.query(
      "SELECT kms_assign_employee_to_group($1, $2, 'educator')",
      [groupA, educatorEmployee]
    );

    await db.query(
      "SELECT kms_assign_employee_to_group($1, $2, 'assistant')",
      [groupA, assistantEmployee]
    );

    const educator = await user('employee', educatorEmployee);
    const assistant = await user('employee', assistantEmployee);
    const teacher = await user('employee', teacherEmployee);
    const legacyTeacher = await user('employee', legacyTeacherEmployee);
    const manager = await user('manager');
    const administrator = await user('admin');

    const parentId = await id(`
      INSERT INTO parents(first_name, last_name, phone)
      VALUES ('Attendance', 'Parent', '+380970000099')
      RETURNING id
    `);

    const parent = await user('parent', null, parentId);

    const ownChild = await child(groupA);
    const foreignChild = await child(groupB);
    const unmarkedChild = await child(groupA);

    // Parent may read only the attendance of their linked child.
    await db.query(
      `INSERT INTO children_parents (child_id, parent_id)
       VALUES ($1, $2)`,
      [ownChild, parentId]
    );

    const markSql = (
      actor = educator,
      childId = ownChild,
      date = today,
      present = true,
      reason = null
    ) => result(
      `SELECT kms_mark_attendance(
        $1, $2, $3::date, $4, $5
      ) AS result`,
      [actor.id, childId, date, present, reason]
    );

    const correctSql = (actor, attendanceId, changes) => result(
      `SELECT kms_correct_attendance(
        $1, $2, $3::jsonb
      ) AS result`,
      [actor.id, attendanceId, JSON.stringify(changes)]
    );

    const reportSql = (actor, groupId = groupA, date = today) =>
      result(
        'SELECT kms_group_attendance($1, $2, $3::date) AS result',
        [actor.id, groupId, date]
      );

    const expectSqlError = (action, message) =>
      assert.rejects(action, { code: 'P0001', message });

    const post = (actor, body) =>
      request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body);

    const patch = (actor, attendanceId, body) =>
      request(app)
        .patch(`/api/v1/attendance/${attendanceId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body);

    const get = (actor, groupId = groupA, date = today) =>
      request(app)
        .get(`/api/v1/groups/${groupId}/attendance`)
        .query({ date })
        .set('Authorization', `Bearer ${actor.token}`);

    const getChildAttendance = (actor, childId = ownChild, query = {}) => {
      const call = request(app)
        .get(`/api/v1/children/${childId}/attendance`)
        .query(query);

      return actor
        ? call.set('Authorization', `Bearer ${actor.token}`)
        : call;
    };

    let todayRecord;
    let oldRecord;

    await t.test('SQL: first mark creates; second updates one row', async () => {
      const first = await markSql();
      const second = await markSql(
        educator, ownChild, today, false, 'Хворіє'
      );

      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.record.id, first.record.id);
      assert.equal(second.record.present, false);
      assert.equal(second.record.reason, 'Хворіє');
      assert.equal(
        String(second.record.marked_by),
        String(educator.id)
      );

      const count = await db.query(
        `SELECT count(*)::int AS count
         FROM attendance
         WHERE child_id = $1 AND attendance_date = $2::date`,
        [ownChild, today]
      );

      assert.equal(count.rows[0].count, 1);
      todayRecord = second.record;
    });

    await t.test('SQL: reason optional; present clears absence reason', async () => {
      const absent = await markSql(
        educator, ownChild, today, false
      );
      assert.equal(absent.record.reason, null);

      const present = await markSql(
        educator, ownChild, today, true, 'Old reason'
      );
      assert.equal(present.record.reason, null);
    });

    await t.test('SQL: foreign group and forbidden roles rejected', async () => {
      await expectSqlError(
        () => markSql(educator, foreignChild),
        'KMS_ATTENDANCE_FORBIDDEN'
      );

      for (const actor of [
        assistant, teacher, legacyTeacher, parent,
        manager, administrator
      ]) {
        await expectSqlError(
          () => markSql(actor),
          'KMS_ATTENDANCE_FORBIDDEN'
        );
      }
    });

    await t.test('SQL: yesterday forbidden and tomorrow invalid', async () => {
      await expectSqlError(
        () => markSql(educator, ownChild, yesterday),
        'KMS_ATTENDANCE_PAST_FORBIDDEN'
      );
      await expectSqlError(
        () => markSql(educator, ownChild, tomorrow),
        'KMS_ATTENDANCE_FUTURE_DATE'
      );
    });

    await t.test('SQL: null parameters rejected', async () => {
      await expectSqlError(
        () => markSql(educator, ownChild, null),
        'KMS_ATTENDANCE_INVALID_PARAMETERS'
      );
      await expectSqlError(
        () => markSql(educator, ownChild, today, null),
        'KMS_ATTENDANCE_INVALID_PARAMETERS'
      );
    });

    await t.test('SQL: separate database timezone does not change today', async () => {
      await db.query("SET TIME ZONE 'Pacific/Honolulu'");
      try {
        const check = await db.query(`
          SELECT kms_attendance_today() =
            (statement_timestamp() AT TIME ZONE 'Europe/Kyiv')::date
            AS correct
        `);
        assert.equal(check.rows[0].correct, true);
        await markSql();
      } finally {
        await db.query("SET TIME ZONE 'UTC'");
      }
    });

    // Historical fixture is inserted directly only into this isolated test DB.
    oldRecord = (await db.query(
      `INSERT INTO attendance(
        child_id, group_id, attendance_date, present,
        reason, marked_by, updated_by
      )
      VALUES ($1, $2, $3::date, false, 'Initial', $4, $4)
      RETURNING *`,
      [ownChild, groupA, yesterday, educator.id]
    )).rows[0];

    await t.test('SQL: past correction only manager/admin; author preserved', async () => {
      for (const actor of [
        educator, assistant, teacher, legacyTeacher, parent
      ]) {
        await expectSqlError(
          () => correctSql(actor, oldRecord.id, { present: true }),
          'KMS_ATTENDANCE_FORBIDDEN'
        );
      }

      for (const actor of [manager, administrator]) {
        const changed = await correctSql(actor, oldRecord.id, {
          present: false,
          reason: 'Уточнено'
        });

        assert.equal(String(changed.marked_by), String(educator.id));
        assert.equal(String(changed.updated_by), String(actor.id));
        assert.equal(changed.reason, 'Уточнено');
      }
    });

    await t.test('SQL: PATCH preserves omitted reason and accepts null', async () => {
      const preserved = await correctSql(manager, oldRecord.id, {
        present: false
      });
      assert.equal(preserved.reason, 'Уточнено');

      const cleared = await correctSql(manager, oldRecord.id, {
        reason: null
      });
      assert.equal(cleared.reason, null);
    });

    await t.test('SQL: invalid corrections and missing record', async () => {
      await expectSqlError(
        () => correctSql(manager, todayRecord.id, { present: false }),
        'KMS_ATTENDANCE_CORRECTION_REQUIRES_PAST'
      );

      for (const changes of [
        {}, { present: null }, { present: 'false' },
        { child_id: foreignChild }, { reason: 123 }
      ]) {
        await expectSqlError(
          () => correctSql(manager, oldRecord.id, changes),
          'KMS_ATTENDANCE_INVALID_PARAMETERS'
        );
      }

      await expectSqlError(
        () => correctSql(manager, -1, { present: true }),
        'KMS_ATTENDANCE_NOT_FOUND'
      );
    });

    await t.test('SQL: group and month reports enforce access', async () => {
      const report = await reportSql(educator);
      const unmarked = report.find(
        row => String(row.child_id) === String(unmarkedChild)
      );
      assert.equal(unmarked.attendance, null);

      await expectSqlError(
        () => reportSql(educator, groupB),
        'KMS_ATTENDANCE_FORBIDDEN'
      );

      for (const actor of [assistant, teacher, legacyTeacher, parent]) {
        await expectSqlError(
          () => reportSql(actor),
          'KMS_ATTENDANCE_FORBIDDEN'
        );

        await expectSqlError(
          () => result(
            `SELECT kms_child_attendance_month(
              $1, $2, $3::date
            ) AS result`,
            [actor.id, ownChild, month]
          ),
          'KMS_ATTENDANCE_FORBIDDEN'
        );
      }

      for (const actor of [manager, administrator]) {
        assert.ok(Array.isArray(await reportSql(actor, groupB)));
      }

      const monthly = await result(
        'SELECT kms_child_attendance_month($1, $2, $3::date) AS result',
        [educator.id, ownChild, month]
      );
      assert.ok(monthly.some(row => row.attendance_date === today));
    });

    await t.test('SQL: blocked user cannot mark', async () => {
      await db.query(
        "UPDATE users SET status = 'blocked' WHERE id = $1",
        [educator.id]
      );

      try {
        await expectSqlError(
          () => markSql(),
          'KMS_ATTENDANCE_FORBIDDEN'
        );
      } finally {
        await db.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [educator.id]
        );
      }
    });

    await t.test('SQL: historical group remains after transfer', async () => {
      const movedChild = await child(groupA);
      await markSql(educator, movedChild);

      await db.query(
        'SELECT transfer_child_to_group($1, $2)',
        [movedChild, groupB]
      );

      const report = await reportSql(manager, groupA);
      assert.ok(report.some(
        row => String(row.child_id) === String(movedChild)
      ));

      const record = await db.query(
        'SELECT group_id FROM attendance WHERE child_id = $1',
        [movedChild]
      );
      assert.equal(String(record.rows[0].group_id), String(groupA));

      await expectSqlError(
        () => markSql(educator, movedChild),
        'KMS_ATTENDANCE_FORBIDDEN'
      );
    });

    await t.test('HTTP: child attendance requires authentication', async () => {
      const response = await getChildAttendance(null);
      assert.equal(response.status, 401, JSON.stringify(response.body));
    });

    await t.test('HTTP: parent can read own child records', async () => {
      const response = await getChildAttendance(parent);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.status, 'success');
      assert.ok(Array.isArray(response.body.data));
      assert.equal(response.body.data.length, 2);
      assert.deepEqual(
        response.body.data.map(row => row.attendance_date),
        [today, yesterday]
      );
      assert.equal(response.body.data[0].present, true);
      assert.equal(response.body.data[0].reason, null);
      assert.equal(response.body.data[1].present, false);
      assert.equal(response.body.data[1].reason, null);
    });

    await t.test('HTTP: parent cannot read unrelated child attendance', async () => {
      const response = await getChildAttendance(parent, foreignChild);
      assert.equal(response.status, 403, JSON.stringify(response.body));
    });

    await t.test('HTTP: admin and manager can read child attendance', async () => {
      for (const actor of [administrator, manager]) {
        const response = await getChildAttendance(actor);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.data.length, 2);
      }
    });

    await t.test('HTTP: employee cannot read parent child attendance endpoint', async () => {
      const response = await getChildAttendance(educator);
      assert.equal(response.status, 403, JSON.stringify(response.body));
    });

    await t.test('HTTP: child attendance filters include both boundaries', async () => {
      const both = await getChildAttendance(parent, ownChild, {
        from: yesterday,
        to: today
      });
      assert.equal(both.status, 200, JSON.stringify(both.body));
      assert.deepEqual(
        both.body.data.map(row => row.attendance_date),
        [today, yesterday]
      );

      const todayOnly = await getChildAttendance(parent, ownChild, {
        from: today,
        to: today
      });
      assert.equal(todayOnly.status, 200, JSON.stringify(todayOnly.body));
      assert.deepEqual(
        todayOnly.body.data.map(row => row.attendance_date),
        [today]
      );

      const pastOnly = await getChildAttendance(parent, ownChild, {
        to: yesterday
      });
      assert.equal(pastOnly.status, 200, JSON.stringify(pastOnly.body));
      assert.deepEqual(
        pastOnly.body.data.map(row => row.attendance_date),
        [yesterday]
      );

      const empty = await getChildAttendance(parent, ownChild, {
        from: tomorrow
      });
      assert.equal(empty.status, 200, JSON.stringify(empty.body));
      assert.deepEqual(empty.body.data, []);
    });

    await t.test('HTTP: child attendance rejects invalid date filters', async () => {
      for (const query of [
        { from: today, to: yesterday },
        { from: '2026-02-30' },
        { from: 'not-a-date' },
        { unexpected: 'value' }
      ]) {
        const response = await getChildAttendance(parent, ownChild, query);
        assert.equal(response.status, 400, JSON.stringify(response.body));
      }
    });

    await t.test('HTTP: own child 201, repeated mark 200', async () => {
      const httpChild = await child(groupA);
      const body = {
        child_id: httpChild,
        date: today,
        present: true
      };

      const first = await post(educator, body);
      assert.equal(first.status, 201, JSON.stringify(first.body));

      const second = await post(educator, {
        ...body,
        present: false,
        reason: 'Хворіє'
      });

      assert.equal(second.status, 200);
      assert.equal(second.body.data.id, first.body.data.id);
      assert.equal(second.body.data.present, false);
    });

    await t.test('HTTP: foreign child, assistant, teacher, parent -> 403', async () => {
      const foreign = await post(educator, {
        child_id: foreignChild,
        date: today,
        present: true
      });
      assert.equal(foreign.status, 403);

      for (const actor of [
        assistant, teacher, legacyTeacher, parent,
        manager, administrator
      ]) {
        const response = await post(actor, {
          child_id: ownChild,
          date: today,
          present: true
        });
        assert.equal(response.status, 403);
      }
    });

    await t.test('HTTP: yesterday, future date and missing auth', async () => {
      assert.equal((await post(educator, {
        child_id: ownChild,
        date: yesterday,
        present: true
      })).status, 403);

      assert.equal((await post(educator, {
        child_id: ownChild,
        date: tomorrow,
        present: true
      })).status, 422);

      assert.equal((await request(app)
        .post('/api/v1/attendance')
        .send({
          child_id: ownChild,
          date: today,
          present: true
        })).status, 401);
    });

    await t.test('HTTP: educator cannot correct, manager/admin can', async () => {
      assert.equal((await patch(
        educator, oldRecord.id, { present: true }
      )).status, 403);

      for (const actor of [manager, administrator]) {
        const response = await patch(actor, oldRecord.id, {
          present: false,
          reason: 'Виправлено після уточнення'
        });
        assert.equal(response.status, 200);
        assert.equal(
          String(response.body.data.updated_by),
          String(actor.id)
        );
      }

      assert.equal((await patch(
        manager, todayRecord.id, { present: true }
      )).status, 422);
    });

    await t.test('HTTP: group report access matrix', async () => {
      assert.equal((await get(educator)).status, 200);
      assert.equal((await get(educator, groupB)).status, 403);

      for (const actor of [manager, administrator]) {
        assert.equal((await get(actor, groupA)).status, 200);
        assert.equal((await get(actor, groupB)).status, 200);
      }

      for (const actor of [assistant, teacher, legacyTeacher, parent]) {
        assert.equal((await get(actor)).status, 403);
      }

      assert.equal((await get(educator, groupA, tomorrow)).status, 422);
    });

    await t.test('HTTP: strict validation rejects forged authors and bad input', async () => {
      for (const body of [
        { child_id: ownChild, date: today, present: 'false' },
        { child_id: ownChild, date: '2026-02-30', present: true },
        {
          child_id: ownChild,
          date: today,
          present: true,
          marked_by: manager.id
        }
      ]) {
        assert.equal((await post(educator, body)).status, 400);
      }

      assert.equal((await patch(manager, oldRecord.id, {})).status, 400);
      assert.equal((await patch(manager, oldRecord.id, {
        attendance_date: today
      })).status, 400);
    });

    await t.test('HTTP: concurrent marks create exactly one record', async () => {
      const concurrentChild = await child(groupA);

      const body = {
        child_id: concurrentChild,
        date: today,
        present: true
      };

      const responses = await Promise.all([
        post(educator, body),
        post(educator, body)
      ]);

      assert.deepEqual(
        responses.map(response => response.status).sort(),
        [200, 201]
      );

      assert.equal(
        responses[0].body.data.id,
        responses[1].body.data.id
      );

      const count = await db.query(
        'SELECT count(*)::int AS count FROM attendance WHERE child_id = $1',
        [concurrentChild]
      );

      assert.equal(count.rows[0].count, 1);
    });

    await t.test('Audit actor is recorded when attendance audit is enabled', async sub => {
      const enabled = await db.query(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = 'attendance'::regclass
            AND NOT tgisinternal
            AND tgfoid = 'kms_audit_row()'::regprocedure
        ) AS enabled
      `);

      if (!enabled.rows[0].enabled) {
        sub.skip('Issue #55 has not enabled attendance audit yet');
        return;
      }

      const auditChild = await child(groupA);
      const response = await post(educator, {
        child_id: auditChild,
        date: today,
        present: true
      });

      assert.equal(response.status, 201);

      const log = await db.query(
        `SELECT actor_user_id
         FROM kms_audit_log
         WHERE table_name = 'attendance'
           AND record_key = $1
           AND operation = 'INSERT'
         ORDER BY id DESC
         LIMIT 1`,
        [String(response.body.data.id)]
      );

      assert.equal(
        String(log.rows[0].actor_user_id),
        String(educator.id)
      );
    });
  } finally {
    if (pool) await pool.end();
    if (db) await db.end();

    if (originalDatabase === undefined) {
      delete process.env.PGDATABASE;
    } else {
      process.env.PGDATABASE = originalDatabase;
    }

    try {
      if (created) {
        await admin.query(
          `DROP DATABASE "${databaseName}" WITH (FORCE)`
        );
      }
    } finally {
      if (connected) await admin.end();
    }
  }
});
