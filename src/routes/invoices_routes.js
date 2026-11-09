
import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { requireInvoiceAccess } from '../middleware/invoiceAccess.js';
import { validateRouteId } from '../middleware/validateRouteId.js';

import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  getInvoiceItems,
  cancelInvoice
} from '../controllers/invoices_controller.js';

import { invoiceSchema } from '../validators/invoice_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.param('id', validateRouteId);

router.get('/', requireRole('admin', 'manager'), getInvoices);

router.get(
  '/:id',
 requireRole('admin', 'manager', 'parent'),
  requireInvoiceAccess,
  getInvoiceById
);

router.get(
  '/:id/items',
  requireRole('admin', 'manager', 'parent'),
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
  '/:id/cancel',
  requireRole('admin'),
  cancelInvoice
);

export default router;
