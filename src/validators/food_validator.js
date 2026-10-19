
const { z } = require('zod');

const foodSchema = z.object({
    name: z.string().trim().min(2).max(100),
    amount: z.number().finite().min(0).max(100000000),
    currency: z.enum(['UAH', 'USD', 'EUR']),
    billingPeriod: z.enum([
        'daily',
        'weekly',
        'monthly'
    ]),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable().optional()
}).refine(
    data => !data.validTo || data.validFrom <= data.validTo,
    {
        path: ['validTo'],
        error: 'Некоректний період дії тарифу'
    }
);

module.exports = foodSchema;
