import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import {
  getHistory,
  getStateAt
} from '../controllers/history_controller.js';
import {
  historyQuerySchema,
  historyStateQuerySchema
} from '../validators/history_validator.js';

const router = Router();

// Only admin has permission to inspect audit history
router.get(
  '/',
  requireRole('admin'),
  validateQuery(historyQuerySchema),
  getHistory
);

router.get(
  '/state',
  requireRole('admin'),
  validateQuery(historyStateQuerySchema),
  getStateAt
);

export default router;

