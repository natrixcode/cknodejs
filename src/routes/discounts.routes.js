import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getDiscounts,
  getDiscountById,
  createDiscount,
  updateDiscount,
  getChildDiscounts,
  addChildDiscount,
  removeChildDiscount
} from '../controllers/discounts_controller.js';

import { discountSchema } from '../validators/discount_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.use(requireRole('admin'));
const updateDiscountSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  percentage: z.union([
    z.literal(10),
    z.literal(20),
    z.literal(30)
  ]).optional(),
  description: z.string().nullable().optional(),
  valid_from: z.iso.date().optional(),
  valid_to: z.iso.date().nullable().optional(),
  is_active: z.boolean().optional()
});

const addChildDiscountSchema = z.strictObject({
  discount_id: z.union([
    z.number().int().positive().safe(),
    z.string().regex(/^[1-9]\d*$/)
  ]).transform(String).refine(
    value => BigInt(value) <= 9223372036854775807n
  )
});

router.get('/', getDiscounts);
router.get('/:childId/discounts', getChildDiscounts);

router.post(
  '/:childId/discounts',
  validateBody(addChildDiscountSchema),
  addChildDiscount
);

router.delete(
  '/:childId/discounts/:discountId',
  removeChildDiscount
);

router.get('/:id', getDiscountById);
router.post('/', validateBody(discountSchema), createDiscount);
router.patch(
  '/:id',
  validateBody(updateDiscountSchema),
  updateDiscount
);

export default router;
