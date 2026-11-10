import {
  ok, fail, missing, rows, one
} from './_common.js';

// Залишок боргу рахує SQL-функція kms_invoice_balance.
const invoiceWithBalance = `
  SELECT
    i.*,
    (i.total_amount - b.balance)::NUMERIC(12,2) AS paid_amount,
    b.balance::NUMERIC(12,2) AS balance_due
  FROM invoices i
  CROSS JOIN LATERAL kms_invoice_balance(i.id) AS b(balance)`;

export async function getInvoices() {
  return ok(
    await rows(
      `${invoiceWithBalance}
       ORDER BY i.id`
    )
  );
}

export async function getInvoiceById(id) {
  const invoice = await one(
    `${invoiceWithBalance}
     WHERE i.id = $1`,
    [id]
  );

  return invoice ? ok(invoice) : missing();
}

export async function createInvoice(data) {
  const {
    months,
    meal_days: mealDays
  } = data.parameters ?? {};

  if (
    ![1, 12].includes(months) ||
    !Number.isInteger(mealDays)
  ) {
    return fail(
      400,
      'parameters повинні містити months (1 або 12) та meal_days (ціле число)'
    );
  }

  if (data.currency !== 'UAH') {
    return fail(
      422,
      'SQL-функція створює рахунки лише в UAH'
    );
  }

  const period = await one(
    `SELECT $1::date = (
       (
         $2::date + make_interval(months => $3)
       ) - interval '1 day'
     )::date AS valid`,
    [data.period_end, data.period_start, months]
  );

  if (!period.valid) {
    return fail(
      400,
      'period_end не збігається з обраним періодом'
    );
  }

  return ok(
    await one(
      'SELECT * FROM kms_issue_invoice($1, $2, $3, $4)',
      [
        data.child_id,
        data.period_start,
        months,
        mealDays
      ]
    ),
    201
  );
}


export async function getInvoiceItems(id) {
  const invoice = await one(
    'SELECT * FROM invoices WHERE id = $1',
    [id]
  );

  if (!invoice) return missing();

  return ok([
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
  ]);
}

export async function cancelInvoice(id) {
  return ok(
    await one(
      'SELECT * FROM kms_cancel_invoice($1)',
      [id]
    )
  );
}