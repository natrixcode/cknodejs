import {
  ok, list, byId, create,
  patch, rows, one
} from './_common.js';

const fields = [
  'first_name',
  'last_name',
  'phone',
  'email'
];

export const getParents = () => list('parents');

export const getParentById = id =>
  byId('parents', id);

export const createParent = data =>
  create('parents', data, fields);

export const updateParent = (id, data) =>
  patch('parents', id, data, fields);

export async function getParentChildren(id) {
  return ok(
    await rows(
      'SELECT * FROM kms_get_parent_children($1)',
      [id]
    )
  );
}

export async function addParentChild(id, data) {
  if (!data?.child_id) {
    return {
      status: 400,
      body: { message: 'Потрібен child_id' }
    };
  }

  const linked = await one(
    'SELECT * FROM kms_link_parent_to_child($1, $2, $3)',
    [
      data.child_id,
      id,
      data.relationship_type ?? 'parent'
    ]
  );

  return ok(linked, 201);
}

export async function getParentInvoices(id) {
  return ok(
    await rows(
      `SELECT DISTINCT i.*
       FROM invoices i
       JOIN children_parents cp
         ON cp.child_id = i.child_id
       WHERE cp.parent_id = $1
       ORDER BY i.id DESC`,
      [id]
    )
  );
}

export async function getParentPayments(id) {
  return ok(
    await rows(
      `SELECT DISTINCT p.*
       FROM payments p
       JOIN invoices i
         ON i.id = p.invoice_id
       JOIN children_parents cp
         ON cp.child_id = i.child_id
       WHERE cp.parent_id = $1
       ORDER BY p.id DESC`,
      [id]
    )
  );
}