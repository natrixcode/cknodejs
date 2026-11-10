
import { z } from 'zod';

export const generateScheduleSchema = z.strictObject({
  group_id: z.number().int().positive().safe(),
  date: z.iso.date().refine(value => value >= '0001-01-01', {
    message: 'Дата повинна бути не раніше 0001-01-01',
  }),
});

const timestampSchema = z.iso.datetime({
  offset: true,
});

export const scheduleSchema = z.strictObject({
  group_id: z.number().int().positive(),

  subject_id: z.number().int().positive()
    .nullable().optional(),

  teacher_id: z.number().int().positive(),

  room_id: z.number().int().positive(),

  start_time: timestampSchema,

  end_time: timestampSchema,

  status: z.enum([
    'draft',
    'published',
  ]).default('draft'),

}).superRefine((data, ctx) => {
  if (
    Date.parse(data.start_time) >=
    Date.parse(data.end_time)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['end_time'],
      message:
        'Завершення повинно бути пізніше початку',
    });
  }

  if (
    data.status === 'published' &&
    data.subject_id == null
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['subject_id'],
      message:
        'Для опублікованого заняття потрібен предмет',
    });
  }
});
