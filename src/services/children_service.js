import { pool } from '../config/database.js';

export async function getChildren() {
  try {
    const result = await pool.query(`
      SELECT
        id,
        first_name,
        last_name,
        date_of_birth,
        group_id,
        dietary_preferences,
        notes,
        created_at
      FROM children
      ORDER BY id ASC
    `);

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getChildById(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const result = await pool.query(
      `SELECT
        id,
        first_name,
        last_name,
        date_of_birth,
        group_id,
        dietary_preferences,
        notes,
        created_at
      FROM children
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createChild(data) {
  try {
    const {
      first_name,
      last_name,
      date_of_birth,
      group_id,
      dietary_preferences,
      notes
    } = data;

    const result = await pool.query(
      `INSERT INTO children (
        first_name,
        last_name,
        date_of_birth,
        group_id,
        dietary_preferences,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        first_name,
        last_name,
        date_of_birth,
        group_id,
        dietary_preferences,
        notes,
        created_at`,
      [
        first_name,
        last_name,
        date_of_birth,
        group_id ?? null,
        dietary_preferences ?? null,
        notes ?? null
      ]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateChild(id, data) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const allowedFields = [
      'first_name',
      'last_name',
      'date_of_birth',
      'group_id',
      'dietary_preferences',
      'notes'
    ];

    const fields = Object.keys(data);

    if (fields.length === 0) {
      return { status: 400, body: {
        message: 'No fields provided for update'
      } };
    }

    if (fields.some(field => !allowedFields.includes(field))) {
      return { status: 400, body: {
        message: 'Invalid fields provided'
      } };
    }

    const setClause = fields.map(
      (field, index) => `${field} = $${index + 1}`
    ).join(', ');

    const values = fields.map(field => data[field]);

    const result = await pool.query(
      `UPDATE children
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING
         id,
         first_name,
         last_name,
         date_of_birth,
         group_id,
         dietary_preferences,
         notes,
         created_at`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function getChildParents(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.phone,
        p.email,
        cp.relationship_type
       FROM parents AS p
       INNER JOIN children_parents AS cp
         ON p.id = cp.parent_id
       WHERE cp.child_id = $1
       ORDER BY p.id ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getChildGroups(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `SELECT
        g.id,
        g.name,
        g.room_id,
        g.age_years,
        g.max_capacity,
        g.created_at
       FROM groups AS g
       INNER JOIN children AS c
         ON c.group_id = g.id
       WHERE c.id = $1`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}


export async function getChildInvoices(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `SELECT *
       FROM invoices
       WHERE child_id = $1
       ORDER BY period_start DESC, id DESC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}


export async function getChildPayments(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id FROM children WHERE id = $1',
      [id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const result = await pool.query(
      `SELECT
        p.id,
        p.invoice_id,
        p.amount,
        p.payment_date,
        p.method,
        p.transaction_id,
        p.currency,
        p.created_at
       FROM payments AS p
       INNER JOIN invoices AS i
         ON p.invoice_id = i.id
       WHERE i.child_id = $1
       ORDER BY p.payment_date DESC, p.id DESC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getChildSchedule(id) {
  try {

    if (!/^[1-9]\d*$/.test(id)) {
      return { status: 400, body: {
        message: 'Invalid child ID'
      } };
    }

    const child = await pool.query(
      'SELECT id, group_id FROM children WHERE id = $1',
      [id]
    );

    if (child.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    const groupId = child.rows[0].group_id;

    if (groupId === null) {
      return { status: 200, body: [] };
    }

    const result = await pool.query(
      `SELECT
        s.id,
        s.group_id,
        s.subject_id,
        s.teacher_id,
        s.room_id,
        s.start_time,
        s.end_time,
        s.status,
        s.created_at
       FROM schedule AS s
       WHERE s.group_id = $1
       ORDER BY s.start_time ASC, s.id ASC`,
      [groupId]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}



