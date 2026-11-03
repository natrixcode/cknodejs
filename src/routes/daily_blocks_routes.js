import { requireAuth, requireRole } from '../middleware/auth.js';
import { Router } from 'express';
import { z } from 'zod';

import {
  getDailyBlocks,
  getDailyBlockById,
  createDailyBlock,
  updateDailyBlock,
  deleteDailyBlock
} from '../controllers/daily_blocks_controller.js';

import {
  dailyBlockSchema,
  dailyBlockPatchSchema
} from '../validators/daily_blocks_validator.js';

import { validateBody } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

const idSchema = z.string()
  .regex(/^[1-9]\d*$/)
  .refine(value => BigInt(value) <= 9223372036854775807n);

router.get('/', getDailyBlocks);

router.get('/:id', (req, res, next) => {
  const parsed = idSchema.safeParse(req.params.id);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid daily block ID'
    });
  }

  return getDailyBlockById(req, res, next);
});

router.post('/', validateBody(dailyBlockSchema), createDailyBlock);

router.patch(
  '/:id',
  (req, res, next) => {
    const parsed = idSchema.safeParse(req.params.id);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid daily block ID'
      });
    }

    next();
  },
  validateBody(dailyBlockPatchSchema),
  updateDailyBlock
);

router.delete('/:id', (req, res, next) => {
  const parsed = idSchema.safeParse(req.params.id);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid daily block ID'
    });
  }

  return deleteDailyBlock(req, res, next);
});

export default router;
