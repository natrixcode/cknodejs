import { Router } from 'express';

import {
  getPayments,
  getPaymentById,
  createPayment,
  getInvoicePayments
} from '../controllers/payments_controller.js';

import { paymentSchema } from '../validators/payment_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.get('/', getPayments);
router.get('/:invoiceId/payments', getInvoicePayments);
router.get('/:id', getPaymentById);
router.post('/', validateBody(paymentSchema), createPayment);

export default router;
