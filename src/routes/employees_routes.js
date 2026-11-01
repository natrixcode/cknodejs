import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  getEmployeeGroups,
  getEmployeeSubjects,
  updateEmployeeSubjects,
  getEmployeeSchedule,
  getEmployeeSalary
} from '../controllers/employees_controller.js';

import { employeeSchema } from '../validators/employee_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const statusSchema = z.strictObject({
  status: z.enum(['active', 'inactive', 'on_leave'])
});

const subjectsSchema = z.strictObject({
  subject_ids: z.array(z.coerce.number().int().positive())
});
router.get('/', requireRole('admin', 'manager'), getEmployees);

router.get(
  '/:id',
  requireRole('admin', 'manager'),
  getEmployeeById
);

router.post(
  '/',
  requireRole('admin'),
  validateBody(employeeSchema),
  createEmployee
);

router.patch(
  '/:id',
  requireRole('admin'),
  validateBody(employeeSchema.partial()),
  updateEmployee
);

router.patch(
  '/:id/status',
  requireRole('admin'),
  validateBody(statusSchema),
  updateEmployeeStatus
);

router.get(
  '/:id/groups',
  requireRole('admin', 'manager'),
  getEmployeeGroups
);

router.get(
  '/:id/subjects',
  requireRole('admin', 'manager'),
  getEmployeeSubjects
);

router.put(
  '/:id/subjects',
  requireRole('admin'),
  validateBody(subjectsSchema),
  updateEmployeeSubjects
);

router.get(
  '/:id/schedule',
  requireRole('admin', 'manager'),
  getEmployeeSchedule
);

router.get(
  '/:id/salary',
  requireRole('admin'),
  getEmployeeSalary
);

export default router;
