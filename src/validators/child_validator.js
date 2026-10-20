
import { z } from 'zod';

export const createChildSchema = z.strictObject({
  first_name: z.string().trim().min(1).max(50),

  last_name: z.string().trim().min(1).max(50),

  date_of_birth: z.iso.date().refine(
    (date) => date < new Date().toISOString().slice(0, 10),
    'Дата народження повинна бути в минулому'
  ),

  group_id: z.number().int().positive()
    .nullable().optional(),

  dietary_preferences: z.string()
    .nullable().optional(),

  notes: z.string().nullable().optional(),
});

export const updateChildSchema =
  createChildSchema.partial();

export const childIdSchema = z.strictObject({
  id: z.coerce.number().int().positive(),
});
