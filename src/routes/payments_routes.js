
import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
import { validateRouteId } from '../middleware/validateRouteId.js';
import {
  requireInvoiceAccess,
  requirePaymentAccess
} from '../middleware/invoiceAccess.js';

import {
  getPayments,
  getPaymentById,
  createPayment,
  getInvoicePayments
} from '../controllers/payments_controller.js';

import { paymentSchema } from '../validators/payment_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.param('id', validateRouteId);
router.param('invoiceId', validateRouteId);
router.get('/', requireRole('admin', 'manager'), getPayments);

router.get(
  '/:invoiceId/payments',
requireRole('admin', 'manager', 'parent'),
  requireInvoiceAccess,
  getInvoicePayments
);

router.get(
  '/:id',
  requireRole('admin', 'manager', 'parent'),
  requirePaymentAccess,
  getPaymentById
);

router.post(
  '/',
  requireRole('admin'),
  validateBody(paymentSchema),
  createPayment
);

export default router;
