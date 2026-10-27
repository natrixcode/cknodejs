import { Router } from 'express';

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

import { parentSchema } from '../validators/parent_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.get('/', getParents);
router.get('/:id', getParentById);
router.post('/', validateBody(parentSchema), createParent);
router.patch('/:id', validateBody(parentSchema.partial()), updateParent);

router.get('/:id/children', getParentChildren);
router.post('/:id/children', addParentChild);
router.get('/:id/invoices', getParentInvoices);
router.get('/:id/payments', getParentPayments);

export default router;
