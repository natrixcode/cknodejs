
import { pool } from '../config/database.js';
import { tuitionSchema } from '../validators/tuition_validator.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const allowedFields = [
  'amount',
  'currency',
  'billing_period',
  'valid_from',
  'valid_to'
];

const columns = `
  id, amount, currency, billing_period,
  valid_from, valid_to, created_at
`;

export async function getTuitionRates() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM tuition_rates
       ORDER BY valid_from DESC, id DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getTuitionRateById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid tuition rate ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM tuition_rates
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Tuition rate not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createTuitionRate(data) {
  try {
    const {
      amount,
      currency,
      billing_period,
      valid_from,
      valid_to = null
    } = data;

    const result = await pool.query(
      `INSERT INTO tuition_rates (
        amount,
        currency,
        billing_period,
        valid_from,
        valid_to
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${columns}`,
      [
        amount,
        currency,
        billing_period,
        valid_from,
        valid_to
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateTuitionRate(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid tuition rate ID'
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
       FROM tuition_rates
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Tuition rate not found'
      } };
    }

    const current = existing.rows[0];

    const merged = {
      amount: Number(current.amount),
      currency: current.currency,
      billing_period: current.billing_period,
      valid_from: current.valid_from,
      valid_to: current.valid_to,
      ...data
    };

    const parsed = tuitionSchema.safeParse(merged);

    if (!parsed.success) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Invalid tuition rate data',
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
      `UPDATE tuition_rates
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

export async function calculateTuition(filters) {
  try {
    const { date, currency, billing_period } = filters;

    const result = await pool.query(
      `SELECT ${columns}
       FROM tuition_rates
       WHERE currency = $1
         AND billing_period = $2
         AND valid_from <= $3::date
         AND (valid_to IS NULL OR valid_to >= $3::date)
       ORDER BY valid_from DESC, id DESC
       LIMIT 1`,
      [currency, billing_period, date]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'No applicable tuition rate found'
      } };
    }

    const rate = result.rows[0];

    return { status: 200, body: {
      date,
      currency: rate.currency,
      billing_period: rate.billing_period,
      tuition_rate_id: rate.id,
      amount: rate.amount,
      valid_from: rate.valid_from,
      valid_to: rate.valid_to
    } };
  } catch (error) {
    throw error;
  }
}
