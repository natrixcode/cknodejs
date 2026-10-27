
import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, child_id, period_start, period_end,
  parameters, currency, tuition_amount,
  meal_amount, discount_amount, total_amount,
  status, created_at
`;

export async function getInvoices() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM invoices
       ORDER BY created_at DESC, id DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getInvoiceById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid invoice ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM invoices
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createInvoice(data) {
  try {
    const {
      child_id,
      period_start,
      period_end,
      parameters = {},
      currency = 'UAH'
    } = data;

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [child_id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `INSERT INTO invoices (
        child_id,
        period_start,
        period_end,
        parameters,
        currency
      )
      VALUES ($1, $2, $3, $4::jsonb, $5)
      RETURNING ${columns}`,
      [
        child_id,
        period_start,
        period_end,
        JSON.stringify(parameters),
        currency
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function recalculateInvoice(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid invoice ID'
      } };
    }

    const result = await pool.query(
      `SELECT id, status
       FROM invoices
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    if (result.rows[0].status !== 'draft') {
      return { status: 409, body: {
        message: 'Only draft invoices can be recalculated'
      } };
    }

    return { status: 501, body: {
      message: 'Invoice calculation rules are not implemented yet'
    } };
  } catch (error) {
    throw error;
  }
}

export async function getInvoiceItems(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid invoice ID'
      } };
    }

    const result = await pool.query(
      `SELECT
         id,
         currency,
         tuition_amount,
         meal_amount,
         discount_amount,
         total_amount
       FROM invoices
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    const invoice = result.rows[0];

    return { status: 200, body: {
      invoice_id: invoice.id,
      currency: invoice.currency,
      items: [
        {
          type: 'tuition',
          amount: invoice.tuition_amount
        },
        {
          type: 'meal',
          amount: invoice.meal_amount
        },
        {
          type: 'discount',
          amount: invoice.discount_amount
        }
      ],
      total_amount: invoice.total_amount
    } };
  } catch (error) {
    throw error;
  }
}

export async function cancelInvoice(id) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid invoice ID'
    } };
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status
       FROM invoices
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    if (existing.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Invoice is already cancelled'
      } };
    }

    if (existing.rows[0].status === 'paid') {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Paid invoice cannot be cancelled'
      } };
    }

    const payments = await client.query(
      `SELECT COUNT(*)::integer AS count
       FROM payments
       WHERE invoice_id = $1`,
      [id]
    );

    if (payments.rows[0].count > 0) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Invoice with payments cannot be cancelled'
      } };
    }

    const result = await client.query(
      `UPDATE invoices
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING ${columns}`,
      [id]
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
