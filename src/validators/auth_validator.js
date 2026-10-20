
import { z } from 'zod';

const passwordSchema = z.string()
  .min(1, 'Вкажіть пароль');

export const authSchema = z.union([
  z.strictObject({
    email: z.email().max(100),
    password: passwordSchema,
  }),

  z.strictObject({
    username: z.string().trim().min(1).max(50),
    password: passwordSchema,
  }),
]);
