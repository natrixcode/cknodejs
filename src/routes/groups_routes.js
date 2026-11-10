import { Router } from 'express';
import { z } from 'zod';

import {
  getGroupAttendance
} from '../controllers/attendance_controller.js';

import {
  validateAttendanceQuery
} from '../validators/attendance_validator.js';

import { requireRole } from '../middleware/auth.js';
import { requireGroupChildrenAccess } from '../middleware/groupChildrenAccess.js';
import { validateBody } from '../middleware/validate.js';
import { validateRouteId } from '../middleware/validateRouteId.js';

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
  addGroupEmployee,
  removeGroupEmployee,
  getGroupSchedule,
  getGroupFinance,
  getGroupCapacity
} from '../controllers/groups_controller.js';

import { groupSchema } from '../validators/group_validator.js';

const router = Router();

router.param('id', validateRouteId);
router.param('childId', validateRouteId);
router.param('employeeId', validateRouteId);

const groupStatusSchema = z.strictObject({
  status: z.enum(['active', 'inactive'])
});

const addGroupChildSchema = z.strictObject({
  child_id: z.coerce.number().int().positive()
});

const addGroupEmployeeSchema = z.strictObject({
  employee_id: z.coerce.number().int().positive(),
  role: z.enum(['educator', 'assistant'])
});

router.get(
  '/:id/attendance',
  validateAttendanceQuery,
  getGroupAttendance
);

router.get(
  '/:id/children',
  requireRole('admin', 'manager', 'employee'),
  requireGroupChildrenAccess,
  getGroupChildren
);

router.get(
  '/:id/schedule',
  requireRole('admin', 'manager', 'employee'),
  requireGroupChildrenAccess,
  getGroupSchedule
);

router.use(requireRole('admin', 'manager'));

router.get('/', getGroups);

router.get('/:id', getGroupById);

router.post(
  '/',
  validateBody(groupSchema),
  createGroup
);

router.patch(
  '/:id',
  validateBody(groupSchema.partial()),
  updateGroup
);

router.patch(
  '/:id/status',
  validateBody(groupStatusSchema),
  updateGroupStatus
);

router.post(
  '/:id/children',
  validateBody(addGroupChildSchema),
  addGroupChild
);

router.delete(
  '/:id/children/:childId',
  removeGroupChild
);

router.get(
  '/:id/employees',
  getGroupEmployees
);

router.post(
  '/:id/employees',
  validateBody(addGroupEmployeeSchema),
  addGroupEmployee
);

router.delete(
  '/:id/employees/:employeeId',
  removeGroupEmployee
);

router.get(
  '/:id/finance',
  requireRole('admin'),
  getGroupFinance
);

router.get(
  '/:id/capacity',
  getGroupCapacity
);

export default router;
