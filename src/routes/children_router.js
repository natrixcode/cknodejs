import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireChildAccess } from '../middleware/childAccess.js';
import {
  getChildren,
  getChildById,
  createChild,
  updateChild,
  getChildParents,
  getChildGroups,
  getChildInvoices,
  getChildPayments,
  getChildSchedule
} from '../controllers/children_controller.js';

import {
  createChildSchema,
  updateChildSchema
} from '../validators/child_validator.js';

import { validateBody } from '../middleware/validate.js';

const router = Router();
router.get(
  '/',
  requireRole('admin', 'manager', 'employee'),
  getChildren
);

router.get(
  '/:id',
  requireChildAccess,
  getChildById
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  validateBody(createChildSchema),
  createChild
);

router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  validateBody(updateChildSchema),
  updateChild
);

router.get(
  '/:id/parents',
  requireRole('admin', 'manager'),
  getChildParents
);

router.get(
  '/:id/groups',
  requireRole('admin', 'manager'),
  getChildGroups
);

router.get(
  '/:id/invoices',
  requireRole('admin', 'manager'),
  getChildInvoices
);

router.get(
  '/:id/payments',
  requireRole('admin', 'manager'),
  getChildPayments
);

router.get(
  '/:id/schedule',
  requireRole('admin', 'manager'),
  getChildSchedule
);
export default router;
