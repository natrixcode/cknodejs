
import { z } from 'zod';

export const reportSchema = z.strictObject({
  start_date: z.iso.date(),

  end_date: z.iso.date(),

  type: z.enum([
    'employees',
    'children',
    'groups',
    'payments',
    'expenses',
    'salary',
    'financial',
  ]),

  filters: z.record(
    z.string(), z.unknown()
  ).default({}),

  page: z.coerce.number()
    .int().min(1).default(1),

  limit: z.coerce.number()
    .int().min(1).max(100).default(20),

  sort_by: z.string()
    .trim().min(1).max(50).optional(),

  sort_order: z.enum([
    'asc', 'desc'
  ]).default('asc'),

}).refine(
  (data) => data.start_date <= data.end_date,
  {
    path: ['end_date'],
    message: 'Некоректний звітний період',
  }
);
