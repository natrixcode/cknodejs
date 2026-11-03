import {
  ok, fail, missing, list,
  byId, rows, one, transaction
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

  return transaction(async db => {
    // Ідемпотентність і блокування рахунка забезпечує
    // kms_register_payment: повторний transaction_id
    // повертає вже наявний платіж, а не створює дубль.
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
      ],
      db
    );

    // Рядок, вставлений саме цією транзакцією, має її xmin.
    // Так PostgreSQL визначає 201 (новий) чи 200 (повтор)
    // без окремої попередньої перевірки, що мала б гонку.
    const { created } = await one(
      `SELECT xmin = pg_current_xact_id()::xid AS created
       FROM payments
       WHERE id = $1`,
      [payment.id],
      db
    );

    return ok(payment, created ? 201 : 200);
  });
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