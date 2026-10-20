
import { z } from 'zod';

const idSchema = z.number().int().positive();

export const userSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),

  email: z.email().max(100),

  username: z.string().trim()
    .min(1).max(50).optional(),

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
  ]),

  parentId: idSchema.nullable().optional(),

  employeeId: idSchema.nullable().optional(),

}).superRefine((data, ctx) => {
  const hasParent = data.parentId != null;
  const hasEmployee = data.employeeId != null;

  if (data.role === 'parent' &&
      (!hasParent || hasEmployee)) {
    ctx.addIssue({
      code: 'custom',
      path: ['parentId'],
      message: 'Для parent потрібен parentId',
    });
  }

  if (data.role === 'employee' &&
      (!hasEmployee || hasParent)) {
    ctx.addIssue({
      code: 'custom',
      path: ['employeeId'],
      message: 'Для employee потрібен employeeId',
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
        'Admin/manager не повинні мати parentId або employeeId',
    });
  }
});
