import { pool } from '../config/database.js';
import { discountSchema } from '../validators/discount_validator.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const columns = `
  id, name, percentage, type, value, currency,
  description, valid_from, valid_to, is_active, created_at
`;

const allowedFields = [
  'name',
  'percentage',
  'description',
  'valid_from',
  'valid_to',
  'is_active'
];

export async function getDiscounts() {
  try {
    const result = await pool.query(
      `SELECT ${columns}
       FROM discounts
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getDiscountById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid discount ID'
      } };
    }

    const result = await pool.query(
      `SELECT ${columns}
       FROM discounts
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Discount not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createDiscount(data) {
  try {
    const {
      name,
      percentage,
      description = null,
      valid_from,
      valid_to = null,
      is_active = true
    } = data;

    const result = await pool.query(
      `INSERT INTO discounts (
        name, percentage, type, description,
        valid_from, valid_to, is_active
      )
      VALUES ($1, $2, 'percent', $3, $4, $5, $6)
      RETURNING ${columns}`,
      [
        name,
        percentage,
        description,
        valid_from,
        valid_to,
        is_active
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') {
      return { status: 409, body: {
        message: 'Discount name already exists'
      } };
    }

    throw error;
  }
}

export async function updateDiscount(id, data) {

  if (!isValidId(id)) {
    return { status: 400, body: {
      message: 'Invalid discount ID'
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
       FROM discounts
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');

      return { status: 404, body: {
        message: 'Discount not found'
      } };
    }

    const current = existing.rows[0];

    if (current.type !== 'percent' ||
        ![10, 20, 30].includes(Number(current.percentage))) {
      await client.query('ROLLBACK');

      return { status: 409, body: {
        message: 'Discount does not match the supported schema'
      } };
    }

    const merged = {
      name: current.name,
      percentage: Number(current.percentage),
      description: current.description,
      valid_from: current.valid_from,
      valid_to: current.valid_to,
      is_active: current.is_active,
      ...data
    };

    const parsed = discountSchema.safeParse(merged);

    if (!parsed.success) {
      await client.query('ROLLBACK');

      return { status: 400, body: {
        message: 'Invalid discount data',
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
      `UPDATE discounts
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

    if (error.code === '23505') {
      return { status: 409, body: {
        message: 'Discount name already exists'
      } };
    }

    throw error;
  } finally {
    client?.release();
  }
}

export async function getChildDiscounts(childId) {
  try {

    if (!isValidId(childId)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [childId]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `SELECT
         cd.id AS assignment_id,
         cd.child_id,
         cd.discount_id,
         cd.assigned_at,
         cd.revoked_at,
         d.name,
         d.percentage,
         d.type,
         d.value,
         d.currency,
         d.description,
         d.valid_from,
         d.valid_to,
         d.is_active
       FROM child_discounts cd
       JOIN discounts d ON d.id = cd.discount_id
       WHERE cd.child_id = $1
       ORDER BY cd.assigned_at DESC, cd.id DESC`,
      [childId]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function addChildDiscount(childId, data) {
  const { discount_id } = data;

  if (!isValidId(childId)) {
    return { status: 400, body: {
      message: 'Invalid child ID'
    } };
  }

  try {
    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [childId]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `INSERT INTO child_discounts (child_id, discount_id)
       SELECT $1, d.id
       FROM discounts d
       WHERE d.id = $2
         AND d.is_active = TRUE
         AND d.valid_from <= CURRENT_DATE
         AND (d.valid_to IS NULL OR d.valid_to >= CURRENT_DATE)
       RETURNING id, child_id, discount_id, assigned_at, revoked_at`,
      [childId, discount_id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Active discount not found for the current date'
      } };
    }

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (
      error.code === '23505' &&
      error.constraint === 'uq_child_discounts_active_child'
    ) {
      return { status: 409, body: {
        message: 'Child already has an active discount assignment'
      } };
    }

    throw error;
  }
}

export async function removeChildDiscount(childId, discountId) {
  try {

    if (!isValidId(childId) || !isValidId(discountId)) {
      return { status: 400, body: {
        message: 'Invalid child or discount ID'
      } };
    }

    const result = await pool.query(
      `UPDATE child_discounts
       SET revoked_at = NOW()
       WHERE child_id = $1
         AND discount_id = $2
         AND revoked_at IS NULL
       RETURNING id, child_id, discount_id, assigned_at, revoked_at`,
      [childId, discountId]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Active discount assignment not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}
