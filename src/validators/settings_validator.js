
import { z } from 'zod';

export const settingsSchema = z.strictObject({
  institution_name: z.string()
    .trim().min(2).max(150),

  email: z.email().max(100),

  phone: z.string().trim().min(7).max(20),

  educational_year: z.string()
    .regex(
      /^\d{4}-\d{4}$/,
      'Формат: YYYY-YYYY'
    )
    .refine(
      (year) => {
        const [start, end] = year
          .split('-').map(Number);

        return end === start + 1;
      },
      {
        message:
          'Навчальні роки повинні бути послідовними',
      }
    ),

  currency: z.enum([
    'UAH', 'USD', 'EUR'
  ]).default('UAH'),

  timezone: z.string()
    .trim().min(1).max(100),

  settings: z.record(
    z.string(), z.unknown()
  ).default({}),
});
