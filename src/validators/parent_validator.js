
import { z } from 'zod';

export const parentSchema = z.strictObject({
  first_name: z.string().trim().min(1).max(50),

  last_name: z.string().trim().min(1).max(50),

  email: z.email().max(100),

  phone: z.string().trim().min(7).max(20),
});
export const parentContactSchema = z.strictObject({
  email: z.email().max(100).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one contact field is required' }
);