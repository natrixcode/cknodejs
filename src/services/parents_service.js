import { pool } from '../config/database.js';

const isValidId = (id) => /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;

const parentFields = [
  'first_name',
  'last_name',
  'email',
  'phone'
];

const handleError = (error) => {
  throw error;
};

export async function getParents() {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, created_at
       FROM parents
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    handleError(error);
  }
}

export async function getParentById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid parent ID' } };
    }

    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, created_at
       FROM parents
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    handleError(error);
  }
}

export async function createParent(data) {
  try {
    const { first_name, last_name, email, phone } = data;

    const result = await pool.query(
      `INSERT INTO parents (first_name, last_name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, first_name, last_name, email, phone, created_at`,
      [first_name, last_name, email, phone]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    handleError(error);
  }
}

export async function updateParent(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid parent ID' } };
    }

    const fields = Object.keys(data);

    if (fields.length === 0 ||
        fields.some(field => !parentFields.includes(field))) {
      return { status: 400, body: {
        message: 'Invalid update fields'
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE parents
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING id, first_name, last_name, email, phone, created_at`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    handleError(error);
  }
}

export async function getParentChildren(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid parent ID' } };
    }

    const parent = await pool.query(
      'SELECT id FROM parents WHERE id = $1',
      [id]
    );

    if (parent.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    const result = await pool.query(
      `SELECT
         c.id,
         c.first_name,
         c.last_name,
         c.date_of_birth,
         c.group_id,
         c.dietary_preferences,
         c.notes,
         cp.relationship_type
       FROM children c
       JOIN children_parents cp ON cp.child_id = c.id
       WHERE cp.parent_id = $1
       ORDER BY c.id ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    handleError(error);
  }
}

export async function addParentChild(id, data) {
  try {
    const { child_id, relationship_type = 'parent' } = data;

    if (!isValidId(id) || !isValidId(String(child_id))) {
      return { status: 400, body: { message: 'Invalid ID' } };
    }

    const parent = await pool.query(
      'SELECT id FROM parents WHERE id = $1',
      [id]
    );

    if (parent.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [child_id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: { message: 'Child not found' } };
    }

    const result = await pool.query(
      `INSERT INTO children_parents
         (child_id, parent_id, relationship_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (child_id, parent_id)
       DO NOTHING
       RETURNING child_id, parent_id, relationship_type`,
      [child_id, id, relationship_type]
    );

    if (result.rows.length === 0) {
      return { status: 409, body: {
        message: 'Relationship already exists'
      } };
    }

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    handleError(error);
  }
}

export async function getParentInvoices(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid parent ID' } };
    }

    const parent = await pool.query(
      'SELECT id FROM parents WHERE id = $1',
      [id]
    );

    if (parent.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    const result = await pool.query(
      `SELECT i.*
       FROM invoices i
       JOIN children_parents cp ON cp.child_id = i.child_id
       WHERE cp.parent_id = $1
       ORDER BY i.period_start DESC, i.id DESC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    handleError(error);
  }
}

export async function getParentPayments(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid parent ID' } };
    }

    const parent = await pool.query(
      'SELECT id FROM parents WHERE id = $1',
      [id]
    );

    if (parent.rows.length === 0) {
      return { status: 404, body: { message: 'Parent not found' } };
    }

    const result = await pool.query(
      `SELECT p.*
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN children_parents cp ON cp.child_id = i.child_id
       WHERE cp.parent_id = $1
       ORDER BY p.payment_date DESC, p.id DESC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    handleError(error);
  }
}
