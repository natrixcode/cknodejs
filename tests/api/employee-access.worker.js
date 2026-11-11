import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import { createSession, revokeSession } from '../../src/utils/sessions.js';

async function main() {
  const database = await pool.query(
    'SELECT current_database() AS name'
  );

  if (!database.rows[0].name.startsWith('cknodejs_employee_access_test_')) {
    throw new Error('Refusing to test against a non-test database');
  }

  const insertEmployee = async (position, phone) => {
    const result = await pool.query(
      `INSERT INTO employees
       (first_name, last_name, phone, position, salary)
       VALUES ('Test', 'Employee', $1, $2, 0)
       RETURNING id`,
      [phone, position]
    );

    return result.rows[0].id;
  };

  const assistantId = await insertEmployee('assistant', '3000001');
  const cookId = await insertEmployee('cook', '3000002');
  const educatorId = await insertEmployee('educator', '3000003');
  const teacherId = await insertEmployee('teacher', '3000004');
  const secondEducatorId = await insertEmployee('educator', '3000005');
  const secondAssistantId = await insertEmployee('assistant', '3000006');

  const groups = [];

  for (let index = 0; index < 2; index++) {
    const room = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 20)
       RETURNING id`,
      [`Employee Access Room ${index}`]
    );

    const group = await pool.query(
      `INSERT INTO groups (name, room_id, age_years)
       VALUES ($1, $2, 3)
       RETURNING id`,
      [`Employee Access Group ${index}`, room.rows[0].id]
    );

    const groupId = group.rows[0].id;

    await pool.query(
      'SELECT kms_assign_employee_to_group($1, $2, $3)',
      [
        groupId,
        index === 0 ? educatorId : secondEducatorId,
        'educator'
      ]
    );

    await pool.query(
      'SELECT kms_assign_employee_to_group($1, $2, $3)',
      [
        groupId,
        index === 0 ? assistantId : secondAssistantId,
        'assistant'
      ]
    );

    await pool.query(
      'SELECT kms_activate_group($1)',
      [groupId]
    );

    groups.push({
      id: groupId,
      roomId: room.rows[0].id
    });
  }

  const children = [];

  for (let index = 0; index < 2; index++) {
    const child = await pool.query(
      `INSERT INTO children
       (first_name, last_name, date_of_birth, group_id)
       VALUES ($1, 'Child', CURRENT_DATE - INTERVAL '3 years', $2)
       RETURNING id`,
      [`Child${index}`, groups[index].id]
    );

    children.push(child.rows[0].id);
  }

  const subject = await pool.query(
    `INSERT INTO subjects (name)
     VALUES ('Employee Access Subject')
     RETURNING id`
  );

  await pool.query(
    `INSERT INTO employee_subjects
     (employee_id, subject_id)
     VALUES ($1, $2)`,
    [teacherId, subject.rows[0].id]
  );

  await pool.query(
    `INSERT INTO schedule
     (group_id, room_id, subject_id, teacher_id, start_time, end_time)
     VALUES ($1, $2, $3, $4,
             '2026-11-02 10:00+02',
             '2026-11-02 11:00+02')`,
    [
      groups[0].id,
      groups[0].roomId,
      subject.rows[0].id,
      teacherId
    ]
  );

  const users = await pool.query(
    `INSERT INTO users
     (username, password_hash, role, employee_id)
     VALUES
       ('employee_access_admin', 'test-hash', 'admin', NULL),
       ('employee_access_assistant', 'test-hash', 'employee', $1),
       ('employee_access_cook', 'test-hash', 'employee', $2),
       ('employee_access_educator', 'test-hash', 'employee', $3),
       ('employee_access_teacher', 'test-hash', 'employee', $4)
     RETURNING id, username`,
    [assistantId, cookId, educatorId, teacherId]
  );

  const getUser = (username) =>
    users.rows.find((user) => user.username === username);

  const accessCases = [
    ['assistant', false],
    ['cook', false],
    ['educator', true],
    ['teacher', true]
  ];

  for (const [role, expected] of accessCases) {
    const user = getUser(`employee_access_${role}`);

    const result = await pool.query(
      'SELECT kms_can_employee_access_api($1) AS allowed',
      [user.id]
    );

    assert.equal(
      result.rows[0].allowed,
      expected,
      `Unexpected SQL access for ${role}`
    );
  }

  console.log('PASS: SQL employee API access rules');

  const sqlTestClient = await pool.connect();

  try {
    await sqlTestClient.query('BEGIN');

    await sqlTestClient.query(
      `UPDATE employees
       SET status = 'inactive'
       WHERE id = $1`,
      [cookId]
    );

    const inactiveEmployeeAccess = await sqlTestClient.query(
      'SELECT kms_can_employee_access_api($1) AS allowed',
      [getUser('employee_access_cook').id]
    );

    assert.equal(inactiveEmployeeAccess.rows[0].allowed, false);

    console.log('PASS: SQL denies inactive employee');

    await sqlTestClient.query(
      `UPDATE users
       SET status = 'blocked'
       WHERE username = 'employee_access_assistant'`
    );

    const blockedUserAccess = await sqlTestClient.query(
      'SELECT kms_can_employee_access_api($1) AS allowed',
      [getUser('employee_access_assistant').id]
    );

    assert.equal(blockedUserAccess.rows[0].allowed, false);

    console.log('PASS: SQL denies blocked user');

    const missingEmployeeAccess = await sqlTestClient.query(
      'SELECT kms_can_employee_access_api($1) AS allowed',
      [999999999]
    );

    assert.equal(missingEmployeeAccess.rows[0].allowed, false);

    console.log('PASS: SQL denies unknown user');
  } finally {
    try {
      await sqlTestClient.query('ROLLBACK');
    } finally {
      sqlTestClient.release();
    }
  }

  for (const role of ['teacher', 'user', 'moderator']) {
    await assert.rejects(
      pool.query(
        `INSERT INTO users
         (username, password_hash, role)
         VALUES ($1, 'test-hash', $2)`,
        [`invalid_role_${role}`, role]
      ),
      (error) => error.code === '23514'
    );
  }

  console.log('PASS: SQL rejects deprecated roles on insert');

  for (const role of ['teacher', 'user', 'moderator']) {
    await assert.rejects(
      pool.query(
        `UPDATE users
         SET role = $1
         WHERE username = 'employee_access_educator'`,
        [role]
      ),
      (error) => error.code === '23514'
    );
  }

  console.log('PASS: SQL rejects deprecated roles on update');

  const tokens = {};

  for (const role of [
    'admin',
    'assistant',
    'cook',
    'educator',
    'teacher'
  ]) {
    tokens[role] = createSession(
      getUser(`employee_access_${role}`).id
    ).token;
  }

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) {
        return resolve();
      }

      server.once('listening', resolve);
      server.once('error', reject);
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}/api/v1`;

    async function request(path, token, method = 'GET', body) {
      return fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    }

    const protectedPaths = [
      '/children',
      '/discounts',
      '/employees',
      '/expenses',
      '/food',
      '/groups',
      '/invoices',
      '/parents',
      '/payments',
      '/reports',
      '/rooms',
      '/salaries',
      '/schedule',
      '/daily-blocks',
      '/settings',
      '/subjects',
      '/tuition',
      '/users'
    ];

    for (const path of protectedPaths) {
      const response = await request(path, tokens.assistant);

      assert.equal(
        response.status,
        403,
        `Assistant: ${path} returned ${response.status}`
      );
    }

    console.log('PASS: Assistant cannot access protected APIs');

    for (const path of protectedPaths) {
      const response = await request(path, tokens.cook);

      assert.equal(
        response.status,
        403,
        `Cook: ${path} returned ${response.status}`
      );
    }

    console.log('PASS: Cook cannot access protected APIs');

    for (const role of ['assistant', 'cook']) {
      const response = await request('/health', tokens[role]);

      assert.equal(response.status, 200);

      console.log(
        `PASS: ${role === 'assistant' ? 'Assistant' : 'Cook'} can access health`
      );
    }

    const adminResponse = await request('/children', tokens.admin);

    assert.equal(adminResponse.status, 200);

    console.log('PASS: Admin can access children');

    const unauthorizedResponse = await request('/children');

    assert.equal(unauthorizedResponse.status, 401);

    console.log('PASS: Unauthenticated request is rejected');

    const educatorResponse = await request(
      '/children',
      tokens.educator
    );

    assert.equal(educatorResponse.status, 200);

    const educatorBody = await educatorResponse.json();

    assert.equal(educatorBody.status, 'success');
    assert.equal(educatorBody.data.length, 1);
    assert.equal(educatorBody.data[0].first_name, 'Child0');
    assert.equal(String(educatorBody.data[0].id), String(children[0]));

    console.log('PASS: Educator sees only own group children');

    const ownChildResponse = await request(
      `/children/${children[0]}`,
      tokens.educator
    );

    assert.equal(ownChildResponse.status, 200);

    const otherChildResponse = await request(
      `/children/${children[1]}`,
      tokens.educator
    );

    assert.equal(otherChildResponse.status, 403);

    console.log('PASS: Educator cannot view another group child');

    const teacherResponse = await request(
      '/children',
      tokens.teacher
    );

    assert.equal(teacherResponse.status, 200);

    const teacherBody = await teacherResponse.json();

    assert.equal(teacherBody.status, 'success');
    assert.equal(teacherBody.data.length, 1);
    assert.equal(teacherBody.data[0].first_name, 'Child0');

    assert.deepEqual(
      Object.keys(teacherBody.data[0]).sort(),
      ['first_name', 'last_name', 'age', 'group_id'].sort()
    );

    assert.equal(typeof teacherBody.data[0].age, 'number');
    assert.equal(
      String(teacherBody.data[0].group_id),
      String(groups[0].id)
    );

    console.log('PASS: Teacher sees only permitted child fields');

    const teacherUpdateResponse = await request(
      `/children/${children[0]}`,
      tokens.teacher,
      'PATCH',
      { first_name: 'Changed' }
    );

    assert.equal(teacherUpdateResponse.status, 403);

    console.log('PASS: Teacher cannot update child');

    const teacherOwnChildResponse = await request(
      `/children/${children[0]}`,
      tokens.teacher
    );

    assert.equal(teacherOwnChildResponse.status, 200);

    const teacherOwnChildBody = await teacherOwnChildResponse.json();

    assert.equal(teacherOwnChildBody.status, 'success');

    assert.deepEqual(
      Object.keys(teacherOwnChildBody.data).sort(),
      ['first_name', 'last_name', 'age', 'group_id'].sort()
    );

    assert.equal(teacherOwnChildBody.data.first_name, 'Child0');
    assert.equal(teacherOwnChildBody.data.last_name, 'Child');
    assert.equal(typeof teacherOwnChildBody.data.age, 'number');

    assert.equal(
      String(teacherOwnChildBody.data.group_id),
      String(groups[0].id)
    );

    console.log('PASS: Teacher can view permitted child details');

    const teacherOtherChildResponse = await request(
      `/children/${children[1]}`,
      tokens.teacher
    );

    assert.equal(teacherOtherChildResponse.status, 403);

    console.log('PASS: Teacher cannot view another group child');


    const educatorGroupResponse = await request(
      `/groups/${groups[0].id}/children`,
      tokens.educator
    );

    assert.equal(educatorGroupResponse.status, 200);

    const educatorGroupBody = await educatorGroupResponse.json();

    assert.equal(educatorGroupBody.status, 'success');
    assert.equal(educatorGroupBody.data.length, 1);

    assert.equal(
      String(educatorGroupBody.data[0].id),
      String(children[0])
    );

    console.log('PASS: Educator can view own group children');

    const educatorOtherGroupResponse = await request(
      `/groups/${groups[1].id}/children`,
      tokens.educator
    );

    assert.equal(educatorOtherGroupResponse.status, 403);

    console.log('PASS: Educator cannot view another group children');

    const teacherGroupResponse = await request(
      `/groups/${groups[0].id}/children`,
      tokens.teacher
    );

    assert.equal(teacherGroupResponse.status, 200);

    const teacherGroupBody = await teacherGroupResponse.json();

    assert.equal(teacherGroupBody.status, 'success');
    assert.equal(teacherGroupBody.data.length, 1);

    assert.deepEqual(
      Object.keys(teacherGroupBody.data[0]).sort(),
      ['first_name', 'last_name', 'age', 'group_id'].sort()
    );

    assert.equal(teacherGroupBody.data[0].first_name, 'Child0');

    console.log('PASS: Teacher can view own group limited child fields');

    const teacherOtherGroupResponse = await request(
      `/groups/${groups[1].id}/children`,
      tokens.teacher
    );

    assert.equal(teacherOtherGroupResponse.status, 403);

    console.log('PASS: Teacher cannot view another group children');

    const teacherChangeGroupResponse = await request(
      `/groups/${groups[0].id}/children`,
      tokens.teacher,
      'POST',
      { child_id: children[1] }
    );

    assert.equal(teacherChangeGroupResponse.status, 403);

    console.log('PASS: Teacher cannot modify group children');

    const educatorScheduleResponse = await request(
      `/groups/${groups[0].id}/schedule`,
      tokens.educator
    );

    assert.equal(educatorScheduleResponse.status, 200);

    console.log('PASS: Educator can view own group schedule');

    const educatorOtherScheduleResponse = await request(
      `/groups/${groups[1].id}/schedule`,
      tokens.educator
    );

    assert.equal(educatorOtherScheduleResponse.status, 403);

    console.log('PASS: Educator cannot view another group schedule');

    const teacherScheduleResponse = await request(
      `/groups/${groups[0].id}/schedule`,
      tokens.teacher
    );

    assert.equal(teacherScheduleResponse.status, 200);

    const teacherScheduleBody = await teacherScheduleResponse.json();

    assert.equal(teacherScheduleBody.status, 'success');

    assert.ok(teacherScheduleBody.data.length > 0);

    assert.ok(
      teacherScheduleBody.data.every(
        (lesson) => String(lesson.teacher_id) === String(teacherId)
      )
    );

    console.log('PASS: Teacher can view only own group lessons');

    const teacherOtherScheduleResponse = await request(
      `/groups/${groups[1].id}/schedule`,
      tokens.teacher
    );

    assert.equal(teacherOtherScheduleResponse.status, 403);

    console.log('PASS: Teacher cannot view another group schedule');

    const assistantScheduleResponse = await request(
      `/groups/${groups[0].id}/schedule`,
      tokens.assistant
    );

    assert.equal(assistantScheduleResponse.status, 403);

    console.log('PASS: Assistant cannot view group schedule');

    const secondAdminResponse = await request(
      '/users',
      tokens.admin,
      'POST',
      {
        name: 'Second Administrator',
        email: 'second-admin@example.test',
        username: 'second_admin_test',
        password: 'TestPassword123',
        role: 'admin',
        status: 'active'
      }
    );

    assert.equal(secondAdminResponse.status, 409);

    console.log('PASS: Second admin creation is rejected');

    const managerResponse = await request(
      '/users',
      tokens.admin,
      'POST',
      {
        name: 'Test Manager',
        email: 'test-manager@example.test',
        username: 'employee_access_manager',
        password: 'TestPassword123',
        role: 'manager',
        status: 'active'
      }
    );

    assert.equal(managerResponse.status, 201);

    const managerBody = await managerResponse.json();
    const managerId = managerBody.data.id;

    console.log('PASS: Regular manager creation succeeds');

    const managerToken = createSession(managerId).token;

    for (const resource of ['invoices', 'payments']) {
      const adminResponse = await request(
        `/children/${children[0]}/${resource}`,
        tokens.admin
      );

      assert.equal(adminResponse.status, 200);

      const managerFinanceResponse = await request(
        `/children/${children[0]}/${resource}`,
        managerToken
      );

      assert.equal(managerFinanceResponse.status, 200);

      const managerFinanceBody = await managerFinanceResponse.json();

      assert.equal(managerFinanceBody.status, 'success');
      assert.ok(Array.isArray(managerFinanceBody.data));

      const teacherFinanceResponse = await request(
        `/children/${children[0]}/${resource}`,
        tokens.teacher
      );

      assert.equal(teacherFinanceResponse.status, 403);

      const assistantFinanceResponse = await request(
        `/children/${children[0]}/${resource}`,
        tokens.assistant
      );

      assert.equal(assistantFinanceResponse.status, 403);

      console.log(`PASS: Finance access rules for ${resource}`);
    }

    const promoteResponse = await request(
      `/users/${managerId}/role`,
      tokens.admin,
      'PATCH',
      { role: 'admin' }
    );

    assert.equal(promoteResponse.status, 409);

    console.log('PASS: Promoting manager to admin is rejected');

    const adminId = getUser('employee_access_admin').id;

    const changeAdminRoleResponse = await request(
      `/users/${adminId}/role`,
      tokens.admin,
      'PATCH',
      { role: 'manager' }
    );

    assert.equal(changeAdminRoleResponse.status, 409);

    console.log('PASS: Changing admin role is rejected');

    const blockAdminResponse = await request(
      `/users/${adminId}/status`,
      tokens.admin,
      'PATCH',
      { status: 'blocked' }
    );

    assert.equal(blockAdminResponse.status, 409);

    console.log('PASS: Blocking admin is rejected');

    const blockManagerResponse = await request(
      `/users/${managerId}/status`,
      tokens.admin,
      'PATCH',
      { status: 'blocked' }
    );

    assert.equal(blockManagerResponse.status, 200);

    console.log('PASS: Blocking regular manager succeeds');

    await assert.rejects(
      pool.query(
        'DELETE FROM users WHERE id = $1',
        [adminId]
      ),
      (error) => error.code === '23505'
    );

    console.log('PASS: Deleting admin through SQL is rejected');

    await assert.rejects(
      pool.query(
        'UPDATE users SET is_active = FALSE WHERE id = $1',
        [adminId]
      ),
      (error) => error.code === '23505'
    );

    console.log('PASS: Deactivating admin through SQL is rejected');

  } finally {
    for (const token of Object.values(tokens)) {
      revokeSession(token);
    }

    await new Promise((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
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
