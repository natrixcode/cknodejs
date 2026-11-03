import {
  hashPassword
} from '../utils/password.js';

import {
  ok, fail, missing, rows, one
} from './_common.js';

import {
  revokeUserSessions
} from '../utils/sessions.js';
const publicFields = `
  id, username, name, email,
  role, status, is_active,
  parent_id, employee_id, created_at
`;

export async function getUsers() {
  return ok(
    await rows(
      `SELECT ${publicFields}
       FROM users
       ORDER BY id`
    )
  );
}

export async function getUserById(id) {
  const user = await one(
    `SELECT ${publicFields}
     FROM users
     WHERE id = $1`,
    [id]
  );

  return user ? ok(user) : missing();
}

export async function createUser(data) {
  const hash = await hashPassword(data.password);

  const user = await one(
    `INSERT INTO users (
       username,
       name,
       email,
       password_hash,
       role,
       status,
       is_active,
       parent_id,
       employee_id
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9
     )
     RETURNING ${publicFields}`,
    [
      data.username ?? null,
      data.name,
      data.email,
      hash,
      data.role,
      data.status,
      data.status === 'active',
      data.parent_id ?? null,
      data.employee_id ?? null
    ]
  );

  return ok(user, 201);
}

export async function updateUser(id, data) {
  const changes = { ...data };

  delete changes.password;

  if (data.password !== undefined) {
    changes.password_hash =
      await hashPassword(data.password);
  }

  const keys = [
    'name',
    'email',
    'username',
    'password_hash'
  ].filter(key => Object.hasOwn(changes, key));

  if (!keys.length) {
    return fail(400, 'Немає полів для оновлення');
  }

  const assignments = keys
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const user = await one(
    `UPDATE users
     SET ${assignments}
     WHERE id = $${keys.length + 1}
     RETURNING ${publicFields}`,
    [
      ...keys.map(key => changes[key]),
      id
    ]
  );

  if (!user) {
  return missing();
}

if (data.password !== undefined) {
  revokeUserSessions(id);
}

return ok(user);
}

export async function updateUserRole(id, data) {
  const user = await one(
    `UPDATE users
     SET role = $1,
         parent_id = $2,
         employee_id = $3
     WHERE id = $4
     RETURNING ${publicFields}`,
    [
      data.role,
      data.parent_id ?? null,
      data.employee_id ?? null,
      id
    ]
  );

  return user ? ok(user) : missing();
}

export async function updateUserStatus(id, data) {
  const user = await one(
    `UPDATE users
     SET status = $1,
         is_active = $2
     WHERE id = $3
     RETURNING ${publicFields}`,
    [
      data.status,
      data.status === 'active',
      id
    ]
  );

  if (!user) {
  return missing();
}

if (data.status !== 'active') {
  revokeUserSessions(id);
}

return ok(user);
}