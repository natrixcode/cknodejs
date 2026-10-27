import { Router } from 'express';
import { z } from 'zod';

import {
  getFinanceReport,
  getProfitReport,
  getGroupsProfitReport,
  getGroupProfitReport,
  getExpensesReport,
  getRevenueReport,
  getSalariesReport,
  getBreakEvenReport,
  getDashboardReport
} from '../controllers/reports_controller.js';

const router = Router();

const reportQuerySchema = z.strictObject({
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH')
}).refine(
  data => data.start_date <= data.end_date,
  {
    path: ['end_date'],
    message: 'End date cannot be earlier than start date'
  }
);

router.use((req, res, next) => {
  const parsed = reportQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid report parameters',
      errors: parsed.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  res.locals.reportFilters = parsed.data;
  next();
});

router.get('/finance', getFinanceReport);
router.get('/profit', getProfitReport);
router.get('/profit/groups', getGroupsProfitReport);
router.get('/profit/groups/:groupId', getGroupProfitReport);
router.get('/expenses', getExpensesReport);
router.get('/revenue', getRevenueReport);
router.get('/salaries', getSalariesReport);
router.get('/break-even', getBreakEvenReport);
router.get('/dashboard', getDashboardReport);

export default router;
