
const { z } = require('zod');

const tuitionSchema = z.object({
    amount: z.number().finite().min(0).max(100000000),
    currency: z.enum(['UAH', 'USD', 'EUR']),
    billingPeriod: z.enum([
        'monthly',
        'quarterly',
        'yearly',
        'one_time'
    ]),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable().optional()
}).refine(
    data => !data.validTo || data.validFrom <= data.validTo,
    {
        path: ['validTo'],
        error: 'Дата завершення не може бути раніше дати початку'
    }
);

module.exports = tuitionSchema;
