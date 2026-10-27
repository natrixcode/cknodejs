import {
  one, ok, fail
} from './_common.js';

import {
  verifyPassword
} from '../utils/password.js';

import {
  createSession,
  revokeSession
} from '../utils/sessions.js';

export async function login(data) {
  const field = Object.hasOwn(data, 'email')
    ? 'email'
    : 'username';

  const user = await one(
    `SELECT
       id, name, email, username,
       role, status, is_active, password_hash
     FROM users
     WHERE ${field} = $1`,
    [data[field]]
  );

  if (
    !user ||
    user.status !== 'active' ||
    !user.is_active ||
    !(await verifyPassword(
      data.password,
      user.password_hash
    ))
  ) {
    return fail(
      401,
      'Неправильний логін або пароль'
    );
  }

  const {
    password_hash: omitted,
    ...safeUser
  } = user;

  return ok({
    user: safeUser,
    ...createSession(user.id)
  });
}

export async function logout(token) {
  revokeSession(token);

  return {
    status: 204,
    noContent: true
  };
}