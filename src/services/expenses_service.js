
import { pool } from '../config/database.js';
import { expenseSchema } from '../validators/expense_validator.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, name, amount, date, category,
  description, currency, created_at
`;

const allowedFields = [
  'name',
  'amount',
  'date',
  'category',
  'description',
  'currency'
];

export async function getExpenses() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM expenses
       ORDER BY date DESC, id DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getExpenseById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid expense ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM expenses
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Expense not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createExpense(data) {
  try {
    const {
      name,
      amount,
      date,
      category,
      description = null,
      currency = 'UAH'
    } = data;

    const result = await pool.query(
      `INSERT INTO expenses (
        name,
        amount,
        date,
        category,
        description,
        currency
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${columns}`,
      [
        name,
        amount,
        date,
        category,
        description,
        currency
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateExpense(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid expense ID'
    } };
  }

  const fields = Object.keys(data ?? {});

  if (
    fields.length === 0 ||
    fields.some(field => !allowedFields.includes(field))
  ) {
    return { status: 400, body: {
      message: 'Invalid update fields'
    } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT ${columns}
       FROM expenses
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Expense not found'
      } };
    }

    const current = existing.rows[0];

    const merged = {
      name: current.name,
      amount: Number(current.amount),
      date: current.date,
      category: current.category,
      description: current.description ?? undefined,
      currency: current.currency,
      ...data
    };

    const parsed = expenseSchema.safeParse(merged);

    if (!parsed.success) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Invalid expense data',
        errors: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => parsed.data[field]);

    const result = await client.query(
      `UPDATE expenses
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING ${columns}`,
      [...values, id]
    );

    await client.query('COMMIT');

    return { status: 200, body: result.rows[0] };
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

export async function cancelExpense(id) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid expense ID'
    } };
  }

  return { status: 501, body: {
    message: 'Expense cancellation is not supported by the current database schema'
  } };
}
