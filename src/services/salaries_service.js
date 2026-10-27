import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, employee_id, period_start, period_end,
  base_salary, bonus, deductions, net_salary,
  currency, parameters, created_at
`;

export async function getSalaries() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM salaries
       ORDER BY period_start DESC, id DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getSalaryById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid salary ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM salaries
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Salary record not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function calculateSalary(data) {
  const {
    employee_id,
    period_start,
    period_end,
    base_salary,
    bonus = 0,
    deductions = 0,
    currency = 'UAH',
    parameters = {}
  } = data;

  const amounts = [base_salary, bonus, deductions];

  if (amounts.some(value => !Number.isSafeInteger(value * 100))) {
    return { status: 400, body: {
      message: 'Salary amounts must support two decimal places'
    } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const employee = await client.query(
      `SELECT id, first_name, last_name, position, status
       FROM employees
       WHERE id = $1
       FOR UPDATE`,
      [employee_id]
    );

    if (employee.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Employee not found'
      } };
    }

    const existing = await client.query(
      `SELECT id
       FROM salaries
       WHERE employee_id = $1
         AND period_start = $2
         AND period_end = $3
         AND currency = $4
       LIMIT 1`,
      [employee_id, period_start, period_end, currency]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Salary record already exists for this period'
      } };
    }

    const result = await client.query(
      `INSERT INTO salaries (
         employee_id,
         period_start,
         period_end,
         base_salary,
         bonus,
         deductions,
         currency,
         parameters
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb
       )
       RETURNING ${columns}`,
      [
        employee_id,
        period_start,
        period_end,
        base_salary,
        bonus,
        deductions,
        currency,
        JSON.stringify(parameters)
      ]
    );

    await client.query('COMMIT');

    return { status: 201, body: result.rows[0] };
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

export async function getEmployeeSalaries(employeeId) {
  try {

    if (!isValidId(employeeId)) {
      return { status: 400, body: {
        message: 'Invalid employee ID'
      } };
    }

    const employee = await pool.query(
      'SELECT id FROM employees WHERE id = $1',
      [employeeId]
    );

    if (employee.rows.length === 0) {
      return { status: 404, body: {
        message: 'Employee not found'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM salaries
       WHERE employee_id = $1
       ORDER BY period_start DESC, id DESC`,
      [employeeId]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}
