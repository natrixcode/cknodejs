
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

export const archiveChildSchema = z.strictObject({
  reason: z.string().trim().max(500).optional(),
});

export const childIdSchema = z.strictObject({
  id: z.coerce.number().int().positive(),
});

export const attendanceQuerySchema = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine(
  (data) => !data.from || !data.to || data.from <= data.to,
  {
    message: 'from must be before or equal to to',
    path: ['to'],
  }
);
