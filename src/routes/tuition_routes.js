import { Router } from 'express';
import { z } from 'zod';

import {
  getTuitionRates,
  getTuitionRateById,
  createTuitionRate,
  updateTuitionRate,
  calculateTuition
} from '../controllers/tuition_controller.js';

import { tuitionSchema } from '../validators/tuition_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const updateTuitionSchema = z.strictObject({
  amount: z.number().min(0).max(100000000).optional(),
  currency: z.enum(['UAH', 'USD', 'EUR']).optional(),
  billing_period: z.enum([
    'monthly',
    'quarterly',
    'yearly',
    'one_time'
  ]).optional(),
  valid_from: z.iso.date().optional(),
  valid_to: z.iso.date().nullable().optional()
});

const calculateTuitionSchema = z.strictObject({
  date: z.iso.date(),
  currency: z.enum(['UAH', 'USD', 'EUR']),
  billing_period: z.enum([
    'monthly',
    'quarterly',
    'yearly',
    'one_time'
  ])
});

router.get('/rates', getTuitionRates);
router.get('/rates/:id', getTuitionRateById);
router.post('/rates', validateBody(tuitionSchema), createTuitionRate);
router.patch(
  '/rates/:id',
  validateBody(updateTuitionSchema),
  updateTuitionRate
);

router.get('/calculate', (req, res, next) => {
  const parsed = calculateTuitionSchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid tuition calculation parameters',
      errors: parsed.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  res.locals.tuitionCalculation = parsed.data;
  return next();
}, calculateTuition);

export default router;
