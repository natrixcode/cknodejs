
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  generateSchedule,
  validateSchedule,
  publishSchedule
} from '../controllers/schedule_controller.js';

import { scheduleSchema } from '../validators/schedule_validator.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.use(requireRole('admin', 'manager'));
const idSchema = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/)
]).transform(String).refine(
  value => BigInt(value) <= 9223372036854775807n
);

const schedulePatchSchema = z.strictObject({
  group_id: z.number().int().positive().optional(),
  subject_id: z.number().int().positive().nullable().optional(),
  teacher_id: z.number().int().positive().optional(),
  room_id: z.number().int().positive().optional(),
  start_time: z.iso.datetime({ offset: true }).optional(),
  end_time: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['draft', 'published']).optional()
});

const validateScheduleSchema = z.strictObject({
  group_id: z.number().int().positive(),
  teacher_id: z.number().int().positive(),
  room_id: z.number().int().positive(),
  start_time: z.iso.datetime({ offset: true }),
  end_time: z.iso.datetime({ offset: true }),
  exclude_id: idSchema.optional()
}).refine(
  data => Date.parse(data.end_time) > Date.parse(data.start_time),
  {
    path: ['end_time'],
    message: 'End time must be later than start time'
  }
);

const publishScheduleSchema = z.strictObject({
  schedule_ids: z.array(idSchema).min(1).refine(
    ids => new Set(ids).size === ids.length,
    { message: 'Duplicate schedule IDs' }
  )
});

router.get('/', getSchedules);

router.post('/generate', generateSchedule);
router.post('/validate', validateBody(validateScheduleSchema), validateSchedule);
router.post('/publish', validateBody(publishScheduleSchema), publishSchedule);

router.get('/:id', getScheduleById);
router.post('/', validateBody(scheduleSchema), createSchedule);
router.patch('/:id', validateBody(schedulePatchSchema), updateSchedule);
router.delete('/:id', deleteSchedule);

export default router;
