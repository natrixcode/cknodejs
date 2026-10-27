
import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, invoice_id, amount, payment_date,
  method, transaction_id, currency, created_at
`;

export async function getPayments() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM payments
       ORDER BY payment_date DESC, id DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getPaymentById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid payment ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM payments
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Payment not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createPayment(data) {
  const {
    invoice_id,
    amount,
    payment_date,
    method,
    transaction_id = null,
    currency = 'UAH'
  } = data;

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const invoiceResult = await client.query(
      `SELECT id, total_amount, currency, status
       FROM invoices
       WHERE id = $1
       FOR UPDATE`,
      [invoice_id]
    );

    if (invoiceResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'issued') {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Only issued invoices can accept payments'
      } };
    }

    if (invoice.currency !== currency) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Payment currency does not match invoice currency'
      } };
    }

    const balanceResult = await client.query(
      `SELECT
         i.total_amount,
         COALESCE(SUM(p.amount), 0) AS total_paid,
         i.total_amount - COALESCE(SUM(p.amount), 0) AS remaining,
         $2::numeric AS requested_amount,
         $2::numeric = ROUND($2::numeric, 2) AS valid_precision
       FROM invoices i
       LEFT JOIN payments p ON p.invoice_id = i.id
       WHERE i.id = $1
       GROUP BY i.id, i.total_amount`,
      [invoice_id, amount]
    );

    const balance = balanceResult.rows[0];

    if (!balance.valid_precision) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Payment amount must have at most two decimal places'
      } };
    }

    const validation = await client.query(
      `SELECT
         $1::numeric > 0 AS positive,
         $1::numeric <= $2::numeric AS within_balance`,
      [amount, balance.remaining]
    );

    if (!validation.rows[0].positive ||
        !validation.rows[0].within_balance) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Payment amount exceeds the remaining invoice balance or is invalid',
        remaining_amount: balance.remaining
      } };
    }

    const paymentResult = await client.query(
      `INSERT INTO payments (
         invoice_id,
         amount,
         payment_date,
         method,
         transaction_id,
         currency
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${columns}`,
      [
        invoice_id,
        amount,
        payment_date,
        method,
        transaction_id,
        currency
      ]
    );

    const updatedBalance = await client.query(
      `SELECT
         i.total_amount,
         COALESCE(SUM(p.amount), 0) AS total_paid,
         i.total_amount - COALESCE(SUM(p.amount), 0) AS remaining,
         COALESCE(SUM(p.amount), 0) = i.total_amount AS fully_paid
       FROM invoices i
       LEFT JOIN payments p ON p.invoice_id = i.id
       WHERE i.id = $1
       GROUP BY i.id, i.total_amount`,
      [invoice_id]
    );

    if (updatedBalance.rows[0].fully_paid) {
      await client.query(
        `UPDATE invoices
         SET status = 'paid'
         WHERE id = $1`,
        [invoice_id]
      );
    }

    await client.query('COMMIT');

    return { status: 201, body: {
      payment: paymentResult.rows[0],
      invoice: {
        id: invoice.id,
        status: updatedBalance.rows[0].fully_paid
          ? 'paid'
          : 'issued',
        total_amount: updatedBalance.rows[0].total_amount,
        total_paid: updatedBalance.rows[0].total_paid,
        remaining_amount: updatedBalance.rows[0].remaining
      }
    } };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }

    if (
      error.code === '23505' &&
      error.constraint === 'payments_transaction_id_key'
    ) {
      return { status: 409, body: {
        message: 'Transaction ID already exists'
      } };
    }

    throw error;
  } finally {
    client?.release();
  }
}

export async function getInvoicePayments(invoiceId) {
  try {

    if (!isValidId(invoiceId)) {
      return { status: 400, body: {
        message: 'Invalid invoice ID'
      } };
    }

    const invoiceResult = await pool.query(
      'SELECT id FROM invoices WHERE id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return { status: 404, body: {
        message: 'Invoice not found'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM payments
       WHERE invoice_id = $1
       ORDER BY payment_date DESC, id DESC`,
      [invoiceId]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}
