import { Router } from 'express';
import { z } from 'zod';

import {
  getExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  cancelExpense
} from '../controllers/expenses_controller.js';

import { expenseSchema } from '../validators/expense_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const updateExpenseSchema = z.strictObject({
  name: z.string().trim().min(2).max(150).optional(),
  amount: z.number().positive().max(100000000).optional(),
  date: z.iso.date().optional(),
  category: z.enum([
    'food',
    'salary',
    'utilities',
    'equipment',
    'education',
    'transport',
    'maintenance',
    'other'
  ]).optional(),
  description: z.string().max(1000).optional(),
  currency: z.enum(['UAH', 'USD', 'EUR']).optional()
});

router.get('/', getExpenses);
router.get('/:id', getExpenseById);
router.post('/', validateBody(expenseSchema), createExpense);
router.patch(
  '/:id',
  validateBody(updateExpenseSchema),
  updateExpense
);
router.post('/:id/cancel', cancelExpense);

export default router;
