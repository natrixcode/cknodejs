import { Router } from 'express';

import {
  getSalaries,
  getSalaryById,
  calculateSalary,
  createSalary,
  getEmployeeSalaries
} from '../controllers/salaries_controller.js';

import {
  salarySchema,
  createSalarySchema
} from '../validators/salary_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

router.get('/', getSalaries);
router.post('/', validateBody(createSalarySchema), createSalary);
router.post('/calculate', validateBody(salarySchema), calculateSalary);
router.get('/:employeeId/salaries', getEmployeeSalaries);
router.get('/:id', getSalaryById);

export default router;
