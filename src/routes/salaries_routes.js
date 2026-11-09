import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateRouteId } from '../middleware/validateRouteId.js';
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
router.param('employeeId', validateRouteId);
router.param('id', validateRouteId);
router.use(requireRole('admin'));
router.get('/', getSalaries);
router.post('/', validateBody(createSalarySchema), createSalary);
router.post('/calculate', validateBody(salarySchema), calculateSalary);
router.get('/:employeeId/salaries', getEmployeeSalaries);
router.get('/:id', getSalaryById);

export default router;
