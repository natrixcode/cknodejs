
const { z } = require('zod');

const reportSchema = z.object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    type: z.enum([
        'employees',
        'children',
        'groups',
        'payments',
        'expenses',
        'salary',
        'attendance',
        'financial'
    ]),
    filters: z.record(
        z.string(),
        z.unknown()
    ).default({}),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
    sortBy: z.string().trim().min(1).max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('asc')
}).refine(
    data => data.startDate <= data.endDate,
    {
        path: ['endDate'],
        error: 'Кінець звітного періоду не може бути раніше початку'
    }
);

module.exports = reportSchema;
