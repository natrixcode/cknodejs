
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

// Query-string ID: a positive whole number within BIGINT range.
const queryIdSchema = z.string()
  .regex(/^[1-9]\d*$/, 'ID має бути додатним цілим числом')
  .refine(
    // Zod runs this check even when the regex failed, so only
    // convert values that are already a valid digit string.
    value => !/^[1-9]\d*$/.test(value) ||
      BigInt(value) <= 9223372036854775807n,
    { message: 'ID перевищує допустиме значення' }
  );

// Issue #73 — GET /api/v1/schedule filters.
export const scheduleListQuerySchema = z.strictObject({
  teacher_id: queryIdSchema.optional(),
  room_id: queryIdSchema.optional(),
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

const queryDate = z.iso.date();
const queryGroupId = z.string()
  .regex(/^[1-9]\d*$/)
  .refine(v => BigInt(v) <= 9223372036854775807n);

export const scheduleQuerySchema = z.strictObject({
  date: queryDate.optional(),
  group_id: queryGroupId.optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
  status: z.enum(['draft', 'published']).optional()
}).refine(
  q => !q.from || !q.to || q.from <= q.to,
  { path: ['to'], message: 'to must be >= from' }
);

export const scheduleOverviewQuerySchema = z.strictObject({
  group_id: queryGroupId,
  date: queryDate
});
