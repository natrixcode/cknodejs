import { Router } from 'express';

import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  recalculateInvoice,
  getInvoiceItems,
  cancelInvoice
} from '../controllers/invoices_controller.js';

import { invoiceSchema } from '../validators/invoice_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.get('/', getInvoices);
router.get('/:id', getInvoiceById);

router.post(
  '/',
  validateBody(invoiceSchema),
  createInvoice
);

router.post('/:id/recalculate', recalculateInvoice);
router.get('/:id/items', getInvoiceItems);
router.post('/:id/cancel', cancelInvoice);

export default router;
