
import { z } from 'zod';

export const discountSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),

  percentage: z.union([
    z.literal(10),
    z.literal(20),
    z.literal(30),
  ]),

  description: z.string().nullable().optional(),

  valid_from: z.iso.date(),

  valid_to: z.iso.date().nullable().optional(),

  is_active: z.boolean().default(true),

}).refine(
  (data) => !data.valid_to ||
    data.valid_from <= data.valid_to,
  {
    path: ['valid_to'],
    message: 'Кінець періоду не може бути раніше початку',
  },
);
