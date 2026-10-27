import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const allowedFields = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'position',
  'salary',
  'status'
];

const allowedStatuses = ['active', 'inactive', 'on_leave'];

const employeeColumns = `
  id, first_name, last_name, email, phone,
  position, salary, status, created_at
`;

async function employeeExists(id) {
  const result = await pool.query(
    'SELECT id FROM employees WHERE id = $1',
    [id]
  );

  return result.rows.length > 0;
}

export async function getEmployees() {
  try {
    const result = await pool.query(
      `SELECT ${employeeColumns}
       FROM employees
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getEmployeeById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    const result = await pool.query(
      `SELECT ${employeeColumns}
       FROM employees
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createEmployee(data) {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      position,
      salary,
      status = 'active'
    } = data;

    const result = await pool.query(
      `INSERT INTO employees (
        first_name, last_name, email, phone,
        position, salary, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${employeeColumns}`,
      [
        first_name,
        last_name,
        email,
        phone,
        position,
        salary,
        status
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateEmployee(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    const fields = Object.keys(data);

    if (
      fields.length === 0 ||
      fields.some(field => !allowedFields.includes(field))
    ) {
      return { status: 400, body: { message: 'Invalid update fields' } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE employees
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING ${employeeColumns}`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateEmployeeStatus(id, data) {
  try {
    const { status } = data ?? {};

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    if (!allowedStatuses.includes(status)) {
      return { status: 400, body: { message: 'Invalid employee status' } };
    }

    const result = await pool.query(
      `UPDATE employees
       SET status = $1
       WHERE id = $2
       RETURNING ${employeeColumns}`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function getEmployeeGroups(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    if (!(await employeeExists(id))) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    const result = await pool.query(
      `SELECT
         g.id,
         g.name,
         g.room_id,
         g.age_years,
         g.max_capacity,
         gs.role,
         gs.assigned_at
       FROM group_staff gs
       JOIN groups g ON g.id = gs.group_id
       WHERE gs.employee_id = $1
       ORDER BY g.id ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getEmployeeSubjects(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    if (!(await employeeExists(id))) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    const result = await pool.query(
      `SELECT
         s.id,
         s.name,
         s.description,
         s.created_at
       FROM employee_subjects es
       JOIN subjects s ON s.id = es.subject_id
       WHERE es.employee_id = $1
       ORDER BY s.id ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function updateEmployeeSubjects(id, data) {
  const { subject_ids } = data ?? {};

  if (!isValidId(id)) {
    return { status: 400, body: { message: 'Invalid employee ID' } };
  }

  if (
    !Array.isArray(subject_ids) ||
    subject_ids.some(value => !isValidId(String(value))) ||
    new Set(subject_ids.map(String)).size !== subject_ids.length
  ) {
    return { status: 400, body: { message: 'Invalid subject IDs' } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const employee = await client.query(
      'SELECT id FROM employees WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (employee.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 404, body: { message: 'Employee not found' } };
    }

    const subjects = await client.query(
      'SELECT id FROM subjects WHERE id = ANY($1::bigint[])',
      [subject_ids]
    );

    if (subjects.rows.length !== subject_ids.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: {
        message: 'One or more subjects not found'
      } };
    }

    await client.query(
      'DELETE FROM employee_subjects WHERE employee_id = $1',
      [id]
    );

    if (subject_ids.length > 0) {
      await client.query(
        `INSERT INTO employee_subjects (employee_id, subject_id)
         SELECT $1, UNNEST($2::bigint[])`,
        [id, subject_ids]
      );
    }

    await client.query('COMMIT');

    return { status: 200, body: {
      employee_id: id,
      subject_ids
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

export async function getEmployeeSchedule(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    if (!(await employeeExists(id))) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    const result = await pool.query(
      `SELECT
         id, group_id, subject_id, teacher_id,
         room_id, start_time, end_time, status, created_at
       FROM schedule
       WHERE teacher_id = $1
       ORDER BY start_time ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getEmployeeSalary(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid employee ID' } };
    }

    if (!(await employeeExists(id))) {
      return { status: 404, body: { message: 'Employee not found' } };
    }

    const result = await pool.query(
      `SELECT *
       FROM salaries
       WHERE employee_id = $1
       ORDER BY period_start DESC, id DESC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}
