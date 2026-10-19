
const { z } = require('zod');

const invoiceSchema = z.object({
    childId: z.number().int().positive(),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    parameters: z.record(
        z.string(),
        z.unknown()
    ).default({}),
    currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH')
}).refine(
    data => data.periodStart <= data.periodEnd,
    {
        path: ['periodEnd'],
        error: 'Кінець періоду не може бути раніше його початку'
    }
);

module.exports = invoiceSchema;
