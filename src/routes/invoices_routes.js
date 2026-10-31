
import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { requireInvoiceAccess } from '../middleware/invoiceAccess.js';

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

router.get('/', requireRole('admin'), getInvoices);

router.get(
  '/:id',
  requireRole('admin', 'parent'),
  requireInvoiceAccess,
  getInvoiceById
);

router.get(
  '/:id/items',
  requireRole('admin', 'parent'),
  requireInvoiceAccess,
  getInvoiceItems
);

router.post(
  '/',
  requireRole('admin'),
  validateBody(invoiceSchema),
  createInvoice
);

router.post(
  '/:id/recalculate',
  requireRole('admin'),
  recalculateInvoice
);

router.post(
  '/:id/cancel',
  requireRole('admin'),
  cancelInvoice
);

export default router;
