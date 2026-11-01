import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireParentAccess } from '../middleware/parentAccess.js';
import { parentSchema } from '../validators/parent_validator.js';
import {
  getParents,
  getParentById,
  createParent,
  updateParent,
  getParentChildren,
  addParentChild,
  getParentInvoices,
  getParentPayments
} from '../controllers/parents_controller.js';
import {
  parentContactSchema
} from '../validators/parent_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.get('/', requireRole('admin', 'manager'), getParents);

router.get(
  '/:id',
  requireRole('admin', 'manager', 'parent'),
  requireParentAccess,
  getParentById
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  validateBody(parentSchema),
  createParent
);

router.patch(
  '/:id',
  requireRole('admin', 'manager', 'parent'),
  requireParentAccess,
  (req, res, next) => {
    const schema = req.user.role === 'parent'
      ? parentContactSchema
      : parentSchema.partial();

    return validateBody(schema)(req, res, next);
  },
  updateParent
);

router.get(
  '/:id/children',
  requireRole('admin', 'manager', 'parent'),
  requireParentAccess,
  getParentChildren
);

router.post(
  '/:id/children',
  requireRole('admin', 'manager'),
  addParentChild
);

router.get(
  '/:id/invoices',
  requireRole('admin', 'manager', 'parent'),
  requireParentAccess,
  getParentInvoices
);

router.get(
  '/:id/payments',
  requireRole('admin', 'manager', 'parent'),
  requireParentAccess,
  getParentPayments
);

export default router;
