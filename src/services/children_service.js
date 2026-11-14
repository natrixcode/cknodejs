import {
  ok, list, byId, create, patch, rows, one, missing
} from './_common.js';

const fields = [
  'first_name',
  'last_name',
  'date_of_birth',
  'group_id',
  'dietary_preferences',
  'notes'
];

export async function getChildren(query = {}) {
  const includeArchived = query.archived === 'true' || query.status === 'archived';
  const showAll = query.status === 'all';

  let sql = 'SELECT * FROM children';
  if (showAll) {
    sql += ' ORDER BY id';
  } else if (includeArchived) {
    sql += " WHERE status = 'archived' ORDER BY id";
  } else {
    sql += " WHERE status = 'active' ORDER BY id";
  }

  return ok(await rows(sql));
}

export async function getVisibleChildren(user, query = {}) {
  if (user.role === 'admin' || user.role === 'manager') {
    return getChildren(query);
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

export async function archiveChild(id, reason = null) {
  const result = await one(
    'SELECT * FROM kms_archive_child($1, $2)',
    [id, reason]
  );
  return result ? ok(result) : missing();
}

export async function unarchiveChild(id) {
  const result = await one(
    'SELECT * FROM kms_unarchive_child($1)',
    [id]
  );
  return result ? ok(result) : missing();
}

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

export async function getChildAttendance(id, user, from = null, to = null) {
  return ok(
    await rows(
      `SELECT *
       FROM kms_parent_child_attendance($1, $2, $3, $4)`,
      [user.id, id, from, to]
    )
  );
}
