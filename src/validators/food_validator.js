
import { z } from 'zod';

export const foodSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),

  amount: z.number().finite()
    .min(0).max(100000000),

  currency: z.enum(['UAH', 'USD', 'EUR']),

  billing_period: z.enum([
    'daily',
    'weekly',
    'monthly',
  ]),

  valid_from: z.iso.date(),

  valid_to: z.iso.date().nullable().optional(),

}).refine(
  (data) => !data.valid_to ||
    data.valid_from <= data.valid_to,
  {
    path: ['valid_to'],
    message: 'Некоректний період дії тарифу',
  }
);
