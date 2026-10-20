import { z } from 'zod';
const birthdaySchema = z.iso.date();
export const createChildSchema = z.object({
  name: z.string().trim().min(1, 'Вкажіть ім’я'),
  surname: z.string().trim().min(1, 'Вкажіть прізвище'),
  birthday: birthdaySchema,
});
export const updateChildSchema = createChildSchema.partial();
export const childIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});
