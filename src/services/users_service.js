import { pool } from '../config/database.js';
import { hashPassword } from '../utils/password.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, username, name, email, role,
  parent_id, employee_id, status, is_active, created_at
`;

const profileFields = ['name', 'email', 'username'];

function databaseError(error) {
  if (error.code === '23505') {
    return { status: 409, body: {
      message: 'User or associated record already exists'
    } };
  }

  if (error.code === '23503') {
    return { status: 404, body: {
      message: 'Related parent or employee not found'
    } };
  }

  if (error.code === '23514') {
    return { status: 400, body: {
      message: 'User data violates database constraints'
    } };
  }

  throw error;
}

export async function getUsers() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM users
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getUserById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid user ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'User not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createUser(data) {
  try {
    const {
      username = null,
      name,
      email,
      password,
      role,
      status = 'active',
      parent_id = null,
      employee_id = null
    } = data;

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (
         username, name, email, password_hash,
         role, status, parent_id, employee_id, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${columns}`,
      [
        username,
        name,
        email,
        passwordHash,
        role,
        status,
        parent_id,
        employee_id,
        status === 'active'
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    return databaseError(error);
  }
}

export async function updateUser(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid user ID'
    } };
  }

  const fields = Object.keys(data ?? {});

  if (
    fields.length === 0 ||
    fields.some(
      field => !profileFields.includes(field) && field !== 'password'
    )
  ) {
    return { status: 400, body: {
      message: 'Invalid update fields'
    } };
  }

  try {
    const values = [];
    const assignments = [];

    for (const field of fields) {
      const column = field === 'password'
        ? 'password_hash'
        : field;

      const value = field === 'password'
        ? await hashPassword(data.password)
        : data[field];

      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE users
       SET ${assignments.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${columns}`,
      values
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'User not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    return databaseError(error);
  }
}

export async function updateUserRole(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid user ID'
    } };
  }

  const {
    role,
    parent_id = null,
    employee_id = null
  } = data;

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           parent_id = $2,
           employee_id = $3
       WHERE id = $4
       RETURNING ${columns}`,
      [role, parent_id, employee_id, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'User not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    return databaseError(error);
  }
}

export async function updateUserStatus(id, data) {
  try {
    const { status } = data;

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid user ID'
      } };
    }

    const result = await pool.query(
      `UPDATE users
       SET status = $1,
           is_active = $2
       WHERE id = $3
       RETURNING ${columns}`,
      [status, status === 'active', id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'User not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    return databaseError(error);
  }
}
