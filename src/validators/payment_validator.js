
import { z } from 'zod';

export const paymentSchema = z.strictObject({
  invoice_id: z.number().int().positive(),

  amount: z.number().finite()
    .positive().max(100000000),

  payment_date: z.iso.datetime({
    offset: true,
  }),

  method: z.enum([
    'cash',
    'card',
    'bank_transfer',
    'online',
  ]),

  transaction_id: z.string()
    .trim().min(1).max(200)
    .nullable().optional(),

  currency: z.enum([
    'UAH', 'USD', 'EUR'
  ]).default('UAH'),
});
