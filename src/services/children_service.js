import {
  ok, list, byId, create, patch, rows
} from './_common.js';

const fields = [
  'first_name',
  'last_name',
  'date_of_birth',
  'group_id',
  'dietary_preferences',
  'notes'
];

export const getChildren = () => list('children');

export async function getVisibleChildren(user) {
  if (user.role === 'admin' || user.role === 'manager') {
    return getChildren();
  }

  if (user.role === 'employee' && user.employee_position === 'educator') {
    return ok(
      await rows(
        `SELECT c.*
         FROM children c
         WHERE kms_can_view_child($1, c.id)
         ORDER BY c.id`,
        [user.id]
      )
    );
  }

  if (user.role === 'employee' && user.employee_position === 'teacher') {
    return ok(
      await rows(
        `SELECT
           c.first_name,
           c.last_name,
           EXTRACT(YEAR FROM age(CURRENT_DATE, c.date_of_birth))::int AS age,
           c.group_id
         FROM children c
         WHERE kms_can_view_group_children($1, c.group_id)
         ORDER BY c.id`,
        [user.id]
      )
    );
  }

  return {
    status: 403,
    body: {
      message: 'Insufficient permissions'
    }
  };
}


export const getChildById = id =>
  byId('children', id);

export async function getVisibleChildById(id, user) {
  if (
    user.role === 'employee' &&
    user.employee_position === 'teacher'
  ) {
    const child = await rows(
      `SELECT
         c.first_name,
         c.last_name,
         EXTRACT(YEAR FROM age(CURRENT_DATE, c.date_of_birth))::int AS age,
         c.group_id
       FROM children c
       WHERE c.id = $1
         AND kms_can_view_group_children($2, c.group_id)`,
      [id, user.id]
    );

    return child.length
      ? ok(child[0])
      : {
          status: 403,
          body: { message: 'Access denied' }
        };
  }

  return getChildById(id);
}

export const createChild = data =>
  create('children', data, fields);

export const updateChild = (id, data) =>
  patch('children', id, data, fields);

export async function getChildParents(id) {
  return ok(
    await rows(
      'SELECT * FROM kms_get_child_parents($1)',
      [id]
    )
  );
}

export async function getChildGroups(id) {
  return ok(
    await rows(
      `SELECT g.*
       FROM groups g
       JOIN children c ON c.group_id = g.id
       WHERE c.id = $1`,
      [id]
    )
  );
}

export async function getChildInvoices(id) {
  return ok(
    await rows(
      `SELECT *
       FROM invoices
       WHERE child_id = $1
       ORDER BY id DESC`,
      [id]
    )
  );
}

export async function getChildPayments(id) {
  return ok(
    await rows(
      `SELECT p.*
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.child_id = $1
       ORDER BY p.id DESC`,
      [id]
    )
  );
}

export async function getChildSchedule(id) {
  return ok(
    await rows(
      `SELECT s.*
       FROM schedule s
       JOIN children c ON c.group_id = s.group_id
       WHERE c.id = $1
       ORDER BY s.start_time`,
      [id]
    )
  );
}