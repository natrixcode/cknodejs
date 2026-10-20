
import { z } from 'zod';

export const tuitionSchema = z.strictObject({
  amount: z.number().finite()
    .min(0).max(100000000),

  currency: z.enum([
    'UAH', 'USD', 'EUR'
  ]),

  billing_period: z.enum([
    'monthly',
    'quarterly',
    'yearly',
    'one_time',
  ]),

  valid_from: z.iso.date(),

  valid_to: z.iso.date()
    .nullable().optional(),

}).refine(
  (data) => !data.valid_to ||
    data.valid_from <= data.valid_to,
  {
    path: ['valid_to'],
    message:
      'Дата завершення не може бути раніше початку',
  }
);
