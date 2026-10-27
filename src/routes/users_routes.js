import { Router } from 'express';
import { z } from 'zod';

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserRole,
  updateUserStatus
} from '../controllers/users_controller.js';

import { userSchema } from '../validators/users_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const updateUserSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.email().max(100).optional(),
  username: z.string().trim().min(1).max(50).optional(),
  password: z.string().min(8).optional()
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

const roleSchema = z.strictObject({
  role: z.enum(['admin', 'manager', 'parent', 'employee']),
  parent_id: z.number().int().positive().nullable().optional(),
  employee_id: z.number().int().positive().nullable().optional()
}).superRefine((data, ctx) => {
  const hasParent = data.parent_id != null;
  const hasEmployee = data.employee_id != null;

  if (data.role === 'parent' && (!hasParent || hasEmployee)) {
    ctx.addIssue({
      code: 'custom',
      path: ['parent_id'],
      message: 'Parent role requires parent_id only'
    });
  }

  if (data.role === 'employee' && (!hasEmployee || hasParent)) {
    ctx.addIssue({
      code: 'custom',
      path: ['employee_id'],
      message: 'Employee role requires employee_id only'
    });
  }

  if (
    ['admin', 'manager'].includes(data.role) &&
    (hasParent || hasEmployee)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['role'],
      message: 'Admin and manager cannot have parent or employee links'
    });
  }
});

const statusSchema = z.strictObject({
  status: z.enum(['active', 'inactive', 'blocked', 'pending'])
});

router.get('/', getUsers);
router.get('/:id', getUserById);

router.post(
  '/',
  validateBody(userSchema),
  createUser
);

router.patch(
  '/:id',
  validateBody(updateUserSchema),
  updateUser
);

router.patch(
  '/:id/role',
  validateBody(roleSchema),
  updateUserRole
);

router.patch(
  '/:id/status',
  validateBody(statusSchema),
  updateUserStatus
);

export default router;
