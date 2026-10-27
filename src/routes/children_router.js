import { Router } from 'express';

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

router.get('/', getChildren);
router.get('/:id', getChildById);
router.post('/', validateBody(createChildSchema), createChild);
router.patch('/:id', validateBody(updateChildSchema), updateChild);

router.get('/:id/parents', getChildParents);
router.get('/:id/groups', getChildGroups);
router.get('/:id/invoices', getChildInvoices);
router.get('/:id/payments', getChildPayments);
router.get('/:id/schedule', getChildSchedule);

export default router;
