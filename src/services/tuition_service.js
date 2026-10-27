import {
  ok, fail, list, byId,
  create, patch, one
} from './_common.js';

const fields = [
  'amount',
  'currency',
  'billing_period',
  'valid_from',
  'valid_to'
];

export const getTuitionRates = () =>
  list('tuition_rates');

export const getTuitionRateById = id =>
  byId('tuition_rates', id);

export async function createTuitionRate(data) {
  if (
    data.currency === 'UAH' &&
    data.billing_period === 'monthly' &&
    data.valid_to == null
  ) {
    return ok(
      await one(
        'SELECT * FROM kms_set_tuition_rate($1, $2)',
        [data.amount, data.valid_from]
      ),
      201
    );
  }

  return create('tuition_rates', data, fields);
}

export const updateTuitionRate = (id, data) =>
  patch('tuition_rates', id, data, fields);

export async function calculateTuition(data) {
  if (
    data.currency !== 'UAH' ||
    data.billing_period !== 'monthly'
  ) {
    return fail(
      422,
      'SQL-розрахунок підтримує тільки UAH та monthly'
    );
  }

  return ok(
    await one(
      `SELECT
         kms_get_tuition_rate($1) AS amount,
         $1::date AS date`,
      [data.date]
    )
  );
}