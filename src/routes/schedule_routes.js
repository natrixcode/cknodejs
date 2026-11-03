import { requireAuth, requireRole } from '../middleware/auth.js';

import { Router } from 'express';
import { z } from 'zod';

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

router.use(requireAuth);
router.use(requireRole('admin'));

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
  end_time: z.iso.datetime({ offset: true }).optional()
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'Потрібно передати хоча б одне поле' }
).refine(
  data =>
    !data.start_time ||
    !data.end_time ||
    Date.parse(data.end_time) > Date.parse(data.start_time),
  {
    path: ['end_time'],
    message: 'Завершення повинно бути пізніше початку'
  }
);

const validateScheduleSchema = z.strictObject({
  group_id: z.number().int().positive(),

  teacher_id: z.number().int().positive(),

  room_id: z.number().int().positive(),

  start_time: z.iso.datetime({
    offset: true
  }),

  end_time: z.iso.datetime({
    offset: true
  }),

  exclude_id: idSchema.optional()
}).refine(
  data => Date.parse(data.end_time) > Date.parse(data.start_time),
  {
    path: ['end_time'],
    message: 'End time must be later than start time'
  }
);

const publishScheduleSchema = z.strictObject({
  schedule_ids: z.array(idSchema)
    .min(1)
    .refine(
      ids => new Set(ids).size === ids.length,
      {
        message: 'Duplicate schedule IDs'
      }
    ),

  day_start: z.string()
    .regex(
      /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
      'Час початку дня повинен бути у форматі HH:MM або HH:MM:SS'
    )
    .default('08:00')
});

router.get('/', getSchedules);

router.post(
  '/generate',
  generateSchedule
);

router.post(
  '/validate',
  validateBody(validateScheduleSchema),
  validateSchedule
);

router.post(
  '/publish',
  validateBody(publishScheduleSchema),
  publishSchedule
);

router.get('/:id', getScheduleById);

router.post(
  '/',
  validateBody(scheduleSchema),
  createSchedule
);

router.patch(
  '/:id',
  validateBody(schedulePatchSchema),
  updateSchedule
);

router.delete('/:id', deleteSchedule);

export default router;
