import { z } from 'zod';

export const mealPriceSchema = z.strictObject({
  age_years: z.number().int().min(2).max(5),
  price_per_day: z.number().min(0).max(99999999.99),
  valid_from: z.iso.date()
});

export const updateMealPriceSchema = mealPriceSchema.partial();

export const calculateFoodSchema = z.strictObject({
  age_years: z.coerce.number().int().min(2).max(5),
  days: z.coerce.number().int().min(1).max(366),
  date: z.iso.date()
});
