
import { z } from 'zod';

export const employeeSchema = z.strictObject({
  first_name: z.string().trim().min(1).max(50),

  last_name: z.string().trim().min(1).max(50),

  email: z.email().max(100),

  phone: z.string().trim().min(7).max(20),

  position: z.enum([
    'director',
    'teacher',
    'assistant',
    'cook',
    'nurse',
    'accountant',
    'manager',
    'educator',
  ]),

  salary: z.number().finite()
    .min(0).max(100000000),

  status: z.enum([
    'active',
    'inactive',
    'on_leave',
  ]).default('active'),
});
