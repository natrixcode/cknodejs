
import { Router } from 'express';

import { requireRole } from '../middleware/auth.js';
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
router.get('/', requireRole('admin'), getPayments);

router.get(
  '/:invoiceId/payments',
  requireRole('admin', 'parent'),
  requireInvoiceAccess,
  getInvoicePayments
);

router.get(
  '/:id',
  requireRole('admin', 'parent'),
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
