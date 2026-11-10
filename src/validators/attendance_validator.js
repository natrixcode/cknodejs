import { z } from 'zod';

const MAX_BIGINT = 9223372036854775807n;

const idSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[1-9]\d*$/)
]).transform(String).refine(
  value => BigInt(value) <= MAX_BIGINT,
  { message: 'ID перевищує допустиме значення' }
);

const reasonSchema = z.string().max(1000).nullable();

export const markAttendanceSchema = z.strictObject({
  child_id: idSchema,
  date: z.iso.date(),
  present: z.boolean(),
  reason: reasonSchema.optional()
});

export const correctAttendanceSchema = z.strictObject({
  present: z.boolean().optional(),
  reason: reasonSchema.optional()
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'Потрібно передати хоча б одне поле' }
);

export const attendanceQuerySchema = z.strictObject({
  date: z.iso.date()
});

export function validateAttendanceQuery(req, res, next) {
  const result = attendanceQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Некоректна дата звіту',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  // Express 5: do not assign to req.query.
  req.attendanceQuery = result.data;
  next();
}