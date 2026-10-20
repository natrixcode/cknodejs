
import { z } from 'zod';

export const parentSchema = z.strictObject({
  first_name: z.string().trim().min(1).max(50),

  last_name: z.string().trim().min(1).max(50),

  email: z.email().max(100),

  phone: z.string().trim().min(7).max(20),
});
