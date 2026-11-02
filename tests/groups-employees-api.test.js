
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);
const migrate = fileURLToPath(
  new URL('../src/database/migrate.js', import.meta.url)
);

test('Group employees HTTP API', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable HTTP tests',
  timeout: 120000
}, async (t) => {
  const dbName = `cknodejs_api_test_${randomUUID().replaceAll('-', '')}`;
  const originalDatabase = process.env.PGDATABASE;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000
  });

  let server;
  let pool;
  let adminConnected = false;
  let created = false;

  try {
    await admin.connect();
    adminConnected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 60000
    });

    process.env.PGDATABASE = dbName;

    const { default: app } = await import('../src/app.js');
    ({ pool } = await import('../src/config/database.js'));

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

    async function request(method, path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : {
          body: JSON.stringify(body)
        })
      });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    async function createRecord(path, data) {
      const response = await request('POST', path, data);

      assert.equal(
        response.status,
        201,
        `POST ${path}: ${JSON.stringify(response.body)}`
      );

      return response.body.data;
    }

    const room = await createRecord('/rooms', {
      name: 'API Test Room',
      capacity: 10,
      status: 'available'
    });

    const group = await createRecord('/groups', {
      name: 'API Test Group',
      room_id: Number(room.id),
      age_years: 3,
      max_capacity: 10
    });

    let employeeCounter = 0;

    async function createEmployee(position, status = 'active') {
      const id = randomUUID().slice(0, 8);
      const number = ++employeeCounter;
      return createRecord('/employees', {
        first_name: 'Test',
        last_name: `Employee${id}`,
        email: `employee${id}@example.com`,
        phone: `099${String(number).padStart(7, '0')}`,
        position,
        salary: 20000,
        status
      });
    }

    const educator = await createEmployee('educator');
    const assistant = await createEmployee('assistant');
    const inactive = await createEmployee('educator', 'inactive');

    const endpoint = `/groups/${group.id}/employees`;

    await t.test('Assign educator', async () => {
      const response = await request('POST', endpoint, {
        employee_id: Number(educator.id),
        role: 'educator'
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.data.role, 'educator');
      assert.equal(response.body.data.employee_id, educator.id);
    });

    await t.test('Assign assistant', async () => {
      const response = await request('POST', endpoint, {
        employee_id: Number(assistant.id),
        role: 'assistant'
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.data.role, 'assistant');
      assert.equal(response.body.data.employee_id, assistant.id);
    });

    await t.test('Reject duplicate assignment', async () => {
      const response = await request('POST', endpoint, {
        employee_id: Number(educator.id),
        role: 'educator'
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.message, 'KMS_EMPLOYEE_ALREADY_ASSIGNED');
    });

    await t.test('Reject role mismatch', async () => {
      const response = await request('POST', endpoint, {
        employee_id: Number(assistant.id),
        role: 'educator'
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.message, 'KMS_EMPLOYEE_ROLE_MISMATCH');
    });

    await t.test('Reject inactive employee', async () => {
      const response = await request('POST', endpoint, {
        employee_id: Number(inactive.id),
        role: 'educator'
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.message, 'KMS_EMPLOYEE_INACTIVE');
    });

    await t.test('Reject missing employee', async () => {
      const response = await request('POST', endpoint, {
        employee_id: 999999,
        role: 'educator'
      });

      assert.equal(response.status, 404);
      assert.equal(response.body.message, 'KMS_EMPLOYEE_NOT_FOUND');
    });

    await t.test('Reject missing group', async () => {
      const response = await request(
        'POST',
        '/groups/999999/employees',
        {
          employee_id: Number(educator.id),
          role: 'educator'
        }
      );

      assert.equal(response.status, 404);
      assert.equal(response.body.message, 'KMS_GROUP_NOT_FOUND');
    });

    await t.test('Reject invalid request body', async () => {
      const response = await request('POST', endpoint, {
        employee_id: -1,
        role: 'director'
      });

      assert.equal(response.status, 400);
      assert.ok(Array.isArray(response.body.errors));
    });

    await t.test('Reject staff changes in active group', async () => {
      const activation = await request(
        'PATCH',
        `/groups/${group.id}/status`,
        { status: 'active' }
      );

      assert.equal(activation.status, 200);

      const response = await request(
        'DELETE',
        `${endpoint}/${educator.id}`
      );

      assert.equal(response.status, 409);
      assert.equal(
        response.body.message,
        'KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE'
      );

      const employees = await request('GET', endpoint);

      assert.equal(employees.status, 200);
      assert.equal(employees.body.data.length, 2);
    });
  } finally {
    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      }

      if (pool) {
        await pool.end();
      }
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

        if (originalDatabase === undefined) {
          delete process.env.PGDATABASE;
        } else {
          process.env.PGDATABASE = originalDatabase;
        }
      }
    }
  }
});
