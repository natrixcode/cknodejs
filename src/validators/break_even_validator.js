import { z } from 'zod';

// Параметри сценарію для kms_break_even.
// Query-рядок приходить текстом, тому числа приводимо.
export const breakEvenQuerySchema = z.strictObject({
  age: z.coerce.number().int().min(2).max(5),

  available_rooms: z.coerce.number().int().min(1).max(20),

  meal_days: z.coerce.number().int().min(0).max(31),

  food_cost_per_day: z.coerce.number().finite().min(0).max(100000),

  discount_percent: z.coerce.number().finite()
    .min(0).max(30).default(0),

  currency: z.enum(['UAH']).default('UAH'),
});
