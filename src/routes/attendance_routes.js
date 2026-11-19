import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { validateRouteId } from '../middleware/validateRouteId.js';
import { requireRole } from '../middleware/auth.js';
import {
  markAttendance,
  correctAttendance,
  getGroupAttendance
} from '../controllers/attendance_controller.js';
import {
  markAttendanceSchema,
  correctAttendanceSchema,
  validateAttendanceQuery
} from '../validators/attendance_validator.js';

const router = Router();

router.param('id', validateRouteId);

router.get(
  '/',
  requireRole('admin', 'manager', 'employee'),
  validateAttendanceQuery,
  getGroupAttendance
);

router.post(
  '/',
  validateBody(markAttendanceSchema),
  markAttendance
);

router.patch(
  '/:id',
  validateBody(correctAttendanceSchema),
  correctAttendance
);

export default router;