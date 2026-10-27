import {
  ok, list, patch, one
} from './_common.js';

const fields = [
  'age_years',
  'price_per_day',
  'valid_from'
];

export const getFoodRates = () =>
  list('meal_prices');

export async function createFoodRate(data) {
  return ok(
    await one(
      'SELECT * FROM kms_set_meal_rate($1, $2, $3)',
      [
        data.age_years,
        data.price_per_day,
        data.valid_from
      ]
    ),
    201
  );
}

export const updateFoodRate = (id, data) =>
  patch('meal_prices', id, data, fields);

export async function calculateFoodCost(data) {
  return ok(
    await one(
      `SELECT kms_calculate_meal_cost(
        $1, $2, $3
      ) AS amount`,
      [data.age_years, data.days, data.date]
    )
  );
}