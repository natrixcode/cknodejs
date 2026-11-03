
import { pool } from '../config/database.js';

const validId = value =>
  typeof value === 'string' &&
  /^[1-9]\d*$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

export async function requireInvoiceAccess(req, res, next) {
  try {
    const invoiceId = req.params.id ?? req.params.invoiceId;

    if (!validId(invoiceId)) {
      return res.status(400).json({
        message: 'Invalid invoice ID'
      });
    }

    const result = await pool.query(
      `SELECT kms_can_view_invoice($1, $2) AS allowed`,
      [req.user.id, invoiceId]
    );

    if (!result.rows[0]?.allowed) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

export async function requirePaymentAccess(req, res, next) {
  try {
    const paymentId = req.params.id;

    if (!validId(paymentId)) {
      return res.status(400).json({
        message: 'Invalid payment ID'
      });
    }

    const result = await pool.query(
      `SELECT kms_can_view_invoice($1, p.invoice_id) AS allowed
       FROM payments p
       WHERE p.id = $2`,
      [req.user.id, paymentId]
    );

    if (!result.rows[0]?.allowed) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
