import { pool } from '../config/database.js';

export { pool };

export const ok = (data, status = 200) => ({
  status,
  body: { status: 'success', data }
});

export const fail = (status, message) => ({
  status,
  body: { message }
});

export const missing = () =>
  fail(404, 'Запис не знайдено');

export const unsupported = (message) =>
  fail(501, message);

export async function rows(sql, params = [], db = pool) {
  return (await db.query(sql, params)).rows;
}

export async function one(sql, params = [], db = pool) {
  return (await rows(sql, params, db))[0] ?? null;
}

export async function list(table) {
  return ok(
    await rows(`SELECT * FROM ${table} ORDER BY id`)
  );
}

export async function byId(table, id) {
  const item = await one(
    `SELECT * FROM ${table} WHERE id = $1`,
    [id]
  );

  return item ? ok(item) : missing();
}

export async function create(table, data, allowed) {
  const keys = allowed.filter(
    key => Object.hasOwn(data, key)
  );

  if (!keys.length) {
    return fail(400, 'Немає даних для створення');
  }

  const placeholders = keys
    .map((_, i) => `$${i + 1}`)
    .join(', ');

  const item = await one(
    `INSERT INTO ${table} (${keys.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    keys.map(key => data[key])
  );

  return ok(item, 201);
}

export async function patch(table, id, data, allowed) {
  const keys = allowed.filter(
    key => Object.hasOwn(data, key)
  );

  if (!keys.length) {
    return fail(400, 'Немає полів для оновлення');
  }

  const assignments = keys
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const item = await one(
    `UPDATE ${table}
     SET ${assignments}
     WHERE id = $${keys.length + 1}
     RETURNING *`,
    [...keys.map(key => data[key]), id]
  );

  return item ? ok(item) : missing();
}

export async function transaction(work) {
  const db = await pool.connect();

  try {
    await db.query('BEGIN');

    const result = await work(db);

    await db.query('COMMIT');

    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}