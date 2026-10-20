
import { z } from 'zod';

const idSchema = z.number().int().positive();

export const userSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),

  email: z.email().max(100),

  username: z.string()
    .trim().min(1).max(50).optional(),

  password: z.string().min(8),

  role: z.enum([
    'admin',
    'manager',
    'parent',
    'employee',
  ]),

  status: z.enum([
    'active',
    'inactive',
    'blocked',
    'pending',
  ]).default('active'),

  parent_id: idSchema.nullable().optional(),

  employee_id: idSchema.nullable().optional(),

}).superRefine((data, ctx) => {
  const hasParent = data.parent_id != null;
  const hasEmployee = data.employee_id != null;

  if (
    data.role === 'parent' &&
    (!hasParent || hasEmployee)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['parent_id'],
      message:
        'Для parent потрібен parent_id',
    });
  }

  if (
    data.role === 'employee' &&
    (!hasEmployee || hasParent)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['employee_id'],
      message:
        'Для employee потрібен employee_id',
    });
  }

  if (
    ['admin', 'manager'].includes(data.role) &&
    (hasParent || hasEmployee)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['role'],
      message:
        'Admin і manager не повинні мати ' +
        'parent_id або employee_id',
    });
  }
});
