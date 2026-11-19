import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { hashPassword } from '../../src/utils/password.js';
import { getSession } from '../../src/utils/sessions.js';

test('Issue #76: deactivation, authentication and immutable audit', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB, timeout: 120000,
}, async t => {
  const name = `cknodejs_deactivate_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ database: process.env.MIGRATION_TEST_ADMIN_DB });
  const previous = process.env.PGDATABASE;
  let created = false;
  let db;
  let pool;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../src/database/migrate.js', import.meta.url))], {
      env: { ...process.env, PGDATABASE: name }, timeout: 30000,
    });
    process.env.PGDATABASE = name;
    const { default: app } = await import('../../src/app.js');
    ({ pool } = await import('../../src/config/database.js'));
    db = new Client({ database: name });
    await db.connect();
    const password = randomUUID();
    const hash = await hashPassword(password);
    async function user(username, role = 'manager', links = {}) {
      return (await db.query(`INSERT INTO users (username,password_hash,role,parent_id,employee_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [username, hash, role, links.parent ?? null, links.employee ?? null])).rows[0].id;
    }
    const adminId = await user('admin76', 'admin');
    const target = await user('target76');
    const manager = await user('manager76');
    async function login(username, status = 200) {
      const r = await request(app).post('/api/v1/auth/login').send({ username, password }).expect(status);
      return r.body.data?.token;
    }
    const adminToken = await login('admin76');
    const targetToken = await login('target76');
    const managerToken = await login('manager76');
    const api = (method, path, token = adminToken) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

    await t.test('SQL blocks physical delete even without actor references; admin protection unchanged', async () => {
      await assert.rejects(db.query('DELETE FROM users WHERE id=$1', [manager]), /KMS_USER_DELETE_FORBIDDEN/);
      await assert.rejects(db.query('DELETE FROM users WHERE id=$1', [adminId]), e => e.code === '23505');
      await assert.rejects(db.query('SELECT kms_deactivate_user($1)', [adminId]), /KMS_ADMIN_IMMUTABLE/);
      assert.equal((await db.query('SELECT kms_deactivate_user($1) AS result', [999999])).rows[0].result, false);
    });
    await t.test('DELETE keeps user and complete audit history with actor links', async () => {
      await db.query("SELECT set_config('kms.actor_user_id', $1, false)", [target]);
      await db.query("INSERT INTO rooms(name,capacity) VALUES ('audit76',10)");
      await db.query("SELECT set_config('kms.actor_user_id', '', false)");
      const before = (await db.query('SELECT * FROM kms_audit_log ORDER BY id')).rows;
      const response = await api('delete', `/users/${target}`).expect(204);
      assert.equal(response.text, '');
      assert.deepEqual((await db.query('SELECT status,is_active FROM users WHERE id=$1', [target])).rows,
        [{ status: 'inactive', is_active: false }]);
      const after = (await db.query('SELECT * FROM kms_audit_log ORDER BY id')).rows;
      assert.deepEqual(after.slice(0, before.length), before);
      assert.equal(after.length, before.length + 1);
      assert.equal(after.at(-1).actor_user_id, adminId);
      assert.equal(after.at(-1).new_data.is_active, false);
      assert.equal(after.at(-1).new_data.password_hash, '***');
      assert.ok(after.some(row => row.actor_user_id === target));
      await assert.rejects(db.query('DELETE FROM users WHERE id=$1', [target]), /KMS_USER_DELETE_FORBIDDEN/);
      await assert.rejects(db.query('DELETE FROM kms_audit_log'), /KMS_AUDIT_IMMUTABLE/);
      await api('delete', `/users/${target}`).expect(204);
      assert.deepEqual((await db.query('SELECT * FROM kms_audit_log ORDER BY id')).rows, after);
    });
    await t.test('sessions revoked, old token and new login rejected', async () => {
      assert.equal(getSession(targetToken), null);
      await api('get', '/users', targetToken).expect(401);
      await login('target76', 401);
      // Direct SQL cannot revoke the in-process session: requireAuth must still reject it.
      await db.query('SELECT kms_deactivate_user($1)', [manager]);
      assert.ok(getSession(managerToken));
      await api('get', '/users', managerToken).expect(401);
      await login('manager76', 401);
    });
    await t.test('list defaults to active, parses only literal true/false', async () => {
      for (const suffix of ['', '?include_inactive=false']) {
        const r = await api('get', `/users${suffix}`).expect(200);
        assert.deepEqual(r.body.data.map(u => u.id), [adminId]);
      }
      const all = await api('get', '/users?include_inactive=true').expect(200);
      assert.equal(all.body.data.length, 3);
      for (const value of ['', '1', 'TRUE', 'null', 'true&include_inactive=false']) {
        await api('get', `/users?include_inactive=${value}`).expect(400);
      }
    });
    await t.test('admin only, missing ID, invalid ID and self-deactivation', async () => {
      await api('delete', '/users/999999').expect(404);
      await api('delete', '/users/nope').expect(400);
      await api('delete', `/users/${adminId}`).expect(409);
      await request(app).delete(`/api/v1/users/${target}`).expect(401);
      const parent = (await db.query("INSERT INTO parents(first_name,last_name,phone) VALUES ('Test','Parent','+380501234567') RETURNING id")).rows[0].id;
      const employee = (await db.query("INSERT INTO employees(first_name,last_name,position,phone,salary) VALUES ('Test','Employee','teacher','+380501234568',10000) RETURNING id")).rows[0].id;
      for (const [role, links] of [['manager', {}], ['parent', { parent }], ['employee', { employee }]]) {
        await user(`access76_${role}`, role, links);
        const token = await login(`access76_${role}`);
        await api('delete', `/users/${target}`, token).expect(403);
        await api('get', '/users?include_inactive=true', token).expect(403);
      }
    });
  } finally {
    if (pool) await pool.end();
    if (db) await db.end();
    if (previous === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = previous;
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
