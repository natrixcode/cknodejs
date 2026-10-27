import {
  ok, missing, list, byId, create,
  patch, rows, one, transaction
} from './_common.js';

const fields = [
  'name',
  'percentage',
  'description',
  'valid_from',
  'valid_to',
  'is_active'
];

export const getDiscounts = () =>
  list('discounts');

export const getDiscountById = id =>
  byId('discounts', id);

export const createDiscount = data =>
  create('discounts', data, fields);

export const updateDiscount = (id, data) =>
  patch('discounts', id, data, fields);

export async function getChildDiscounts(childId) {
  return ok(
    await rows(
      `SELECT cd.*, d.name, d.percentage
       FROM child_discounts cd
       JOIN discounts d
         ON d.id = cd.discount_id
       WHERE cd.child_id = $1
       ORDER BY cd.id DESC`,
      [childId]
    )
  );
}

export async function addChildDiscount(childId, data) {
  return ok(
    await one(
      'SELECT * FROM kms_assign_child_discount($1, $2)',
      [childId, data.discount_id]
    ),
    201
  );
}

export async function removeChildDiscount(
  childId,
  discountId
) {
  return transaction(async db => {
    const linked = await one(
      `SELECT id
       FROM child_discounts
       WHERE child_id = $1
         AND discount_id = $2
         AND revoked_at IS NULL
       FOR UPDATE`,
      [childId, discountId],
      db
    );

    if (!linked) return missing();

    await rows(
      'SELECT kms_revoke_child_discount($1)',
      [childId],
      db
    );

    return {
      status: 204,
      noContent: true
    };
  });
}