import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, age_years, price_per_day, valid_from, created_at
`;

export async function getFoodRates() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM meal_prices
       ORDER BY age_years ASC, valid_from DESC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function createFoodRate(data) {
  try {
    const {
      age_years,
      price_per_day,
      valid_from
    } = data;

    const result = await pool.query(
      `INSERT INTO meal_prices (
        age_years,
        price_per_day,
        valid_from
      )
      VALUES ($1, $2, $3)
      RETURNING ${columns}`,
      [age_years, price_per_day, valid_from]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateFoodRate(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid food rate ID'
      } };
    }

    const allowedFields = [
      'age_years',
      'price_per_day',
      'valid_from'
    ];

    const fields = Object.keys(data ?? {});

    if (
      fields.length === 0 ||
      fields.some(field => !allowedFields.includes(field))
    ) {
      return { status: 400, body: {
        message: 'Invalid update fields'
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE meal_prices
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING ${columns}`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Food rate not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function calculateFoodCost(filters) {
  try {
    const { age_years, days, date } = filters;

    const result = await pool.query(
      `SELECT ${columns}
       FROM meal_prices
       WHERE age_years = $1
         AND valid_from <= $2::date
       ORDER BY valid_from DESC, id DESC
       LIMIT 1`,
      [age_years, date]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'No applicable food rate found'
      } };
    }

    const rate = result.rows[0];

    const priceInCents = Math.round(
      Number(rate.price_per_day) * 100
    );

    const totalInCents = priceInCents * days;

    return { status: 200, body: {
      age_years,
      days,
      date,
      food_rate_id: rate.id,
      price_per_day: rate.price_per_day,
      total_amount: (totalInCents / 100).toFixed(2)
    } };
  } catch (error) {
    throw error;
  }
}
