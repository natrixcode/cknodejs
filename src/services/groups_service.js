import {
  ok, fail, missing, list, byId,
  create, patch, rows, one
} from './_common.js';

const fields = [
  'name',
  'room_id',
  'age_years',
  'max_capacity'
];

export const getGroups = () => list('groups');

export const getGroupById = id =>
  byId('groups', id);

export const createGroup = data =>
  create('groups', data, fields);

export const updateGroup = (id, data) =>
  patch('groups', id, data, fields);

export async function updateGroupStatus(id, data) {
  if (!['active', 'inactive'].includes(data?.status)) {
    return fail(
      400,
      'Статус має бути active або inactive'
    );
  }

  const functionName = data.status === 'active'
    ? 'kms_activate_group'
    : 'kms_deactivate_group';

  return ok(
    await one(
      `SELECT * FROM ${functionName}($1)`,
      [id]
    )
  );
}

export async function getGroupChildren(id) {
  return ok(
    await rows(
      `SELECT *
       FROM children
       WHERE group_id = $1
       ORDER BY id`,
      [id]
    )
  );
}

export async function addGroupChild(id, data) {
  return ok(
    await one(
      'SELECT * FROM assign_child_to_group($1, $2)',
      [data.child_id, id]
    )
  );
}

export async function removeGroupChild(id, childId) {
  const assigned = await one(
    `SELECT id FROM children
     WHERE id = $1 AND group_id = $2`,
    [childId, id]
  );

  if (!assigned) return missing();

  return ok(
    await one(
      'SELECT * FROM remove_child_from_group($1)',
      [childId]
    )
  );
}

export async function getGroupEmployees(id) {
  return ok(
    await rows(
      `SELECT e.*, gs.role AS group_role
       FROM employees e
       JOIN group_staff gs
         ON gs.employee_id = e.id
       WHERE gs.group_id = $1
       ORDER BY e.id`,
      [id]
    )
  );
}

export async function addGroupEmployee(id, data) {
  return ok(
    await one(
      'SELECT * FROM kms_assign_employee_to_group($1, $2, $3)',
      [id, data.employee_id, data.role]
    ),
    201
  );
}

export async function removeGroupEmployee(
  id,
  employeeId
) {
  await rows(
    'SELECT kms_remove_employee_from_group($1, $2)',
    [id, employeeId]
  );

  return {
    status: 204,
    noContent: true
  };
}

export async function getGroupSchedule(id) {
  return ok(
    await rows(
      `SELECT *
       FROM schedule
       WHERE group_id = $1
       ORDER BY start_time`,
      [id]
    )
  );
}

export async function getGroupFinance(id) {
  const report = await one(
    `SELECT *
     FROM kms_group_financial_report(
       $1,
       date_trunc('month', CURRENT_DATE)::date,
       (
         date_trunc('month', CURRENT_DATE)
         + interval '1 month - 1 day'
       )::date
     )`,
    [id]
  );

  return ok(report);
}

export async function getGroupCapacity(id) {
  const capacity = await one(
    'SELECT * FROM check_group_capacity($1)',
    [id]
  );

  return capacity ? ok(capacity) : missing();
}