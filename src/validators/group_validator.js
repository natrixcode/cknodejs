
import { z } from 'zod';

export const groupSchema = z.strictObject({
  name: z.string().trim()
    .min(1, 'Вкажіть назву групи')
    .max(50),

  room_id: z.coerce.number().int().positive(),

  age_years: z.coerce.number().int().min(2).max(5),

  max_capacity: z.coerce.number().int()
    .min(1).max(20).optional(),
});
