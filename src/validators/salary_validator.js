
import { z } from 'zod';

export const salarySchema = z.strictObject({
  employee_id: z.number().int().positive(),

  period_start: z.iso.date(),

  period_end: z.iso.date(),

  base_salary: z.number().finite()
    .min(0).max(100000000),

  bonus: z.number().finite()
    .min(0).max(100000000).default(0),

  deductions: z.number().finite()
    .min(0).max(100000000).default(0),

  currency: z.enum([
    'UAH', 'USD', 'EUR'
  ]).default('UAH'),

  parameters: z.record(
    z.string(), z.unknown()
  ).default({}),

}).refine(
  (data) => data.period_start <= data.period_end,
  {
    path: ['period_end'],
    message: 'Некоректний період виплати',
  }
).refine(
  (data) =>
    data.deductions <= data.base_salary + data.bonus,
  {
    path: ['deductions'],
    message:
      'Утримання перевищують нараховану суму',
  }
);
