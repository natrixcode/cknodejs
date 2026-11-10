import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { validateRouteId } from '../middleware/validateRouteId.js';
import {
  markAttendance,
  correctAttendance
} from '../controllers/attendance_controller.js';
import {
  markAttendanceSchema,
  correctAttendanceSchema
} from '../validators/attendance_validator.js';

const router = Router();

router.param('id', validateRouteId);

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