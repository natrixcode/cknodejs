import { pool } from '../config/database.js';

const isValidId = (id) => {
  return typeof id === 'string' &&
    /^[1-9]\d*$/.test(id) &&
    BigInt(id) <= 9223372036854775807n;
};

const allowedFields = [
  'name',
  'room_id',
  'age_years',
  'max_capacity'
];

export async function getGroups() {
  try {
    const result = await pool.query(
      `SELECT
        id,
        name,
        room_id,
        age_years,
        max_capacity,
        created_at
       FROM groups
       ORDER BY id ASC`
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getGroupById(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid group ID'
      } };
    }

    const result = await pool.query(
      `SELECT
        id,
        name,
        room_id,
        age_years,
        max_capacity,
        created_at
       FROM groups
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Group not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function createGroup(data) {
  try {
    const {
      name,
      room_id,
      age_years,
      max_capacity = 20
    } = data;

    const result = await pool.query(
      `INSERT INTO groups (
        name,
        room_id,
        age_years,
        max_capacity
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        room_id,
        age_years,
        max_capacity,
        created_at`,
      [name, room_id, age_years, max_capacity]
    );

    return { status: 201, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateGroup(id, data) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid group ID'
      } };
    }

    const fields = Object.keys(data);

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
      `UPDATE groups
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING
         id,
         name,
         room_id,
         age_years,
         max_capacity,
         created_at`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Group not found'
      } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}

export async function updateGroupStatus() {
  return { status: 501, body: {
    message: 'Group status management is not implemented'
  } };
}

export async function getGroupChildren(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: {
        message: 'Invalid group ID'
      } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: {
        message: 'Group not found'
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
       WHERE group_id = $1
       ORDER BY last_name ASC, first_name ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function addGroupChild(id, data) {
  const { child_id } = data ?? {};

  if (!isValidId(id) || !isValidId(String(child_id))) {
    return { status: 400, body: {
      message: 'Invalid group or child ID'
    } };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const groupResult = await client.query(
      `SELECT id, age_years, max_capacity
       FROM groups
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (groupResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 404, body: {
        message: 'Group not found'
      } };
    }

    const childResult = await client.query(
      `SELECT id, group_id
       FROM children
       WHERE id = $1
       FOR UPDATE`,
      [child_id]
    );

    if (childResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 404, body: {
        message: 'Child not found'
      } };
    }

    if (childResult.rows[0].group_id !== null) {
      await client.query('ROLLBACK');
      return { status: 409, body: {
        message: 'Child is already assigned to a group'
      } };
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM children
       WHERE group_id = $1`,
      [id]
    );

    if (countResult.rows[0].total >= groupResult.rows[0].max_capacity) {
      await client.query('ROLLBACK');
      return { status: 409, body: {
        message: 'Group capacity exceeded'
      } };
    }

    const result = await client.query(
      `UPDATE children
       SET group_id = $1
       WHERE id = $2
       RETURNING
         id,
         first_name,
         last_name,
         date_of_birth,
         group_id,
         dietary_preferences,
         notes,
         created_at`,
      [id, child_id]
    );

    await client.query('COMMIT');

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function removeGroupChild(id, childId) {
  try {

    if (!isValidId(id) || !isValidId(childId)) {
      return { status: 400, body: {
        message: 'Invalid group or child ID'
      } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: {
        message: 'Group not found'
      } };
    }

    const result = await pool.query(
      `UPDATE children
       SET group_id = NULL
       WHERE id = $1 AND group_id = $2
       RETURNING id`,
      [childId, id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Child is not assigned to this group'
      } };
    }

    return { status: 204, noContent: true };
  } catch (error) {
    throw error;
  }
}

export async function getGroupEmployees(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid group ID' } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: { message: 'Group not found' } };
    }

    const result = await pool.query(
      `SELECT
         e.id,
         e.first_name,
         e.last_name,
         e.position,
         e.email,
         e.phone,
         e.status,
         gs.role,
         gs.assigned_at
       FROM group_staff gs
       JOIN employees e ON e.id = gs.employee_id
       WHERE gs.group_id = $1
       ORDER BY gs.role ASC, e.id ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function removeGroupEmployee(id, employeeId) {
  try {

    if (!isValidId(id) || !isValidId(employeeId)) {
      return { status: 400, body: {
        message: 'Invalid group or employee ID'
      } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: { message: 'Group not found' } };
    }

    const result = await pool.query(
      `DELETE FROM group_staff
       WHERE group_id = $1 AND employee_id = $2
       RETURNING employee_id`,
      [id, employeeId]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Employee is not assigned to this group'
      } };
    }

    return { status: 204, noContent: true };
  } catch (error) {
    throw error;
  }
}

export async function getGroupSchedule(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid group ID' } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: { message: 'Group not found' } };
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
       FROM schedule s
       WHERE s.group_id = $1
       ORDER BY s.start_time ASC`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getGroupFinance(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid group ID' } };
    }

    const group = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [id]
    );

    if (group.rows.length === 0) {
      return { status: 404, body: { message: 'Group not found' } };
    }

    const result = await pool.query(
      `SELECT
         i.currency,
         COUNT(i.id)::integer AS invoice_count,
         COALESCE(SUM(i.total_amount), 0) AS total_invoiced
       FROM invoices i
       JOIN children c ON c.id = i.child_id
       WHERE c.group_id = $1
       GROUP BY i.currency
       ORDER BY i.currency`,
      [id]
    );

    return { status: 200, body: result.rows };
  } catch (error) {
    throw error;
  }
}

export async function getGroupCapacity(id) {
  try {

    if (!isValidId(id)) {
      return { status: 400, body: { message: 'Invalid group ID' } };
    }

    const result = await pool.query(
      `SELECT
         g.id,
         g.name,
         g.max_capacity,
         COUNT(c.id)::integer AS current_count,
         (g.max_capacity - COUNT(c.id))::integer AS available_places
       FROM groups g
       LEFT JOIN children c ON c.group_id = g.id
       WHERE g.id = $1
       GROUP BY g.id, g.name, g.max_capacity`,
      [id]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { message: 'Group not found' } };
    }

    return { status: 200, body: result.rows[0] };
  } catch (error) {
    throw error;
  }
}
