import {
  ok, fail, missing, list,
  byId, rows, one
} from './_common.js';

export const getPayments = () =>
  list('payments');

export const getPaymentById = id =>
  byId('payments', id);

export async function createPayment(data) {
  if (!data.transaction_id) {
    return fail(
      400,
      'transaction_id є обов’язковим у SQL'
    );
  }

  const invoice = await one(
    'SELECT currency FROM invoices WHERE id = $1',
    [data.invoice_id]
  );

  if (!invoice) return missing();

  if (data.currency !== invoice.currency) {
    return fail(
      422,
      'Валюта платежу не збігається з рахунком'
    );
  }

  const payment = await one(
    `SELECT * FROM kms_register_payment(
      $1, $2, $3, $4, $5
    )`,
    [
      data.invoice_id,
      data.amount,
      data.method,
      data.transaction_id,
      data.payment_date
    ]
  );

  return ok(payment, 201);
}

export async function getInvoicePayments(invoiceId) {
  return ok(
    await rows(
      `SELECT *
       FROM payments
       WHERE invoice_id = $1
       ORDER BY id`,
      [invoiceId]
    )
  );
}