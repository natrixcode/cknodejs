import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const allowedFields = ['name', 'description'];

export async function getSubjects() {
  try {
    const result = await pool.query(
      `SELECT id, name, description, created_at
       FROM subjects
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getSubjectById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid subject ID'
      } };
    }

    const result = await pool.query(
      `SELECT id, name, description, created_at
       FROM subjects
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Subject not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createSubject(data) {
  try {
    const { name, description = null } = data;

    const result = await pool.query(
      `INSERT INTO subjects (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, created_at`,
      [name, description]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateSubject(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid subject ID'
      } };
    }

    const fields = Object.keys(data);

    if (
      fields.length === 0 ||
      fields.some(field => !allowedFields.includes(field))
    ) {
      return { status: 400, body: {
        message: 'Invalid update fields'
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE subjects
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING id, name, description, created_at`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Subject not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function getSubjectTeachers(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid subject ID'
      } };
    }

    const subject = await pool.query(
      'SELECT id FROM subjects WHERE id = $1',
      [id]
    );

    if (subject.rows.length === 0) {
      return { status: 404, body: {
        message: 'Subject not found'
      } };
    }

    const result = await pool.query(
      `SELECT
         e.id,
         e.first_name,
         e.last_name,
         e.email,
         e.phone,
         e.position,
         e.status
       FROM employee_subjects es
       JOIN employees e ON e.id = es.employee_id
       WHERE es.subject_id = $1
       ORDER BY e.last_name ASC, e.first_name ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function updateSubjectTeachers(id, data) {
  const { employee_ids } = data ?? {};

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid subject ID'
    } };
  }

  if (
    !Array.isArray(employee_ids) ||
    employee_ids.some(value => !isValidId(String(value))) ||
    new Set(employee_ids.map(String)).size !== employee_ids.length
  ) {
    return { status: 400, body: {
      message: 'Invalid employee IDs'
    } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const subject = await client.query(
      'SELECT id FROM subjects WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (subject.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Subject not found'
      } };
    }

    const employees = await client.query(
      'SELECT id FROM employees WHERE id = ANY($1::bigint[])',
      [employee_ids]
    );

    if (employees.rows.length !== employee_ids.length) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'One or more employees not found'
      } };
    }

    await client.query(
      'DELETE FROM employee_subjects WHERE subject_id = $1',
      [id]
    );

    if (employee_ids.length > 0) {
      await client.query(
        `INSERT INTO employee_subjects (employee_id, subject_id)
         SELECT UNNEST($1::bigint[]), $2`,
        [employee_ids, id]
      );
    }

    await client.query('COMMIT');

    return { status: 200, body: {
      subject_id: id,
      employee_ids
    } };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    throw error;
  } finally {
    client?.release();
  }
}
