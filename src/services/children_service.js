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

export const getChildById = id =>
  byId('children', id);

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