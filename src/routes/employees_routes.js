import { Router } from 'express';
import { z } from 'zod';

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

router.get('/', getEmployees);
router.get('/:id', getEmployeeById);
router.post('/', validateBody(employeeSchema), createEmployee);
router.patch('/:id', validateBody(employeeSchema.partial()), updateEmployee);
router.patch('/:id/status', validateBody(statusSchema), updateEmployeeStatus);

router.get('/:id/groups', getEmployeeGroups);
router.get('/:id/subjects', getEmployeeSubjects);
router.put('/:id/subjects', validateBody(subjectsSchema), updateEmployeeSubjects);
router.get('/:id/schedule', getEmployeeSchedule);
router.get('/:id/salary', getEmployeeSalary);

export default router;
