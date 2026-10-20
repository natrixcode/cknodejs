
import { z } from 'zod';

export const subjectSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),

  description: z.string()
    .max(1000).nullable().optional(),
});

export const assignEmployeeSubjectSchema =
  z.strictObject({
    employee_id: z.number().int().positive(),

    subject_id: z.number().int().positive(),
  });
