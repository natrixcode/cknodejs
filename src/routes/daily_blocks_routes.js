import { requireAuth, requireRole } from '../middleware/auth.js';
import { Router } from 'express';
import { validateRouteId } from '../middleware/validateRouteId.js';

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

router.param('id', validateRouteId);

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', getDailyBlocks);

router.get('/:id', getDailyBlockById);

router.post('/', validateBody(dailyBlockSchema), createDailyBlock);

router.patch(
  '/:id',
  validateBody(dailyBlockPatchSchema),
  updateDailyBlock
);

router.delete('/:id', deleteDailyBlock);

export default router;
