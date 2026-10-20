
import { z } from 'zod';

export const invoiceSchema = z.strictObject({
  child_id: z.number().int().positive(),

  period_start: z.iso.date(),

  period_end: z.iso.date(),

  parameters: z.record(
    z.string(), z.unknown()
  ).default({}),

  currency: z.enum([
    'UAH', 'USD', 'EUR'
  ]).default('UAH'),

}).refine(
  (data) => data.period_start <= data.period_end,
  {
    path: ['period_end'],
    message:
      'Кінець періоду не може бути раніше початку',
  }
);
