import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  updateGroupStatus,
  getGroupChildren,
  addGroupChild,
  removeGroupChild,
  getGroupEmployees,
  removeGroupEmployee,
  getGroupSchedule,
  getGroupFinance,
  getGroupCapacity
} from '../controllers/groups_controller.js';

import { groupSchema } from '../validators/group_validator.js';
import { validateBody } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();
router.use(requireRole('admin'));
const groupStatusSchema = z.strictObject({
  status: z.enum(['active', 'inactive'])
});

const addGroupChildSchema = z.strictObject({
  child_id: z.coerce.number().int().positive()
});

router.get('/', getGroups);
router.get('/:id', getGroupById);
router.post('/', validateBody(groupSchema), createGroup);
router.patch('/:id', validateBody(groupSchema.partial()), updateGroup);
router.patch(
  '/:id/status',
  validateBody(groupStatusSchema),
  updateGroupStatus
);

router.get('/:id/children', getGroupChildren);
router.post('/:id/children', validateBody(addGroupChildSchema), addGroupChild);
router.delete('/:id/children/:childId', removeGroupChild);

router.get('/:id/employees', getGroupEmployees);
router.delete('/:id/employees/:employeeId', removeGroupEmployee);

router.get('/:id/schedule', getGroupSchedule);
router.get('/:id/finance', getGroupFinance);
router.get('/:id/capacity', getGroupCapacity);

export default router;
