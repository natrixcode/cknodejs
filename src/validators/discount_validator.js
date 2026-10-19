
const { z } = require('zod');

const discountSchema = z.object({
    name: z.string().trim().min(2).max(100),
    type: z.enum(['fixed', 'percent']),
    value: z.number().finite().positive(),
    currency: z.enum(['UAH', 'USD', 'EUR']).optional(),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable().optional(),
    isActive: z.boolean().default(true)
}).refine(
    data => data.type !== 'percent' || data.value <= 100,
    {
        path: ['value'],
        error: 'Відсоток знижки не може перевищувати 100'
    }
).refine(
    data => data.type !== 'fixed' || !!data.currency,
    {
        path: ['currency'],
        error: 'Для фіксованої знижки необхідно вказати валюту'
    }
).refine(
    data => !data.validTo || data.validFrom <= data.validTo,
    {
        path: ['validTo'],
        error: 'Некоректний період дії знижки'
    }
);

module.exports = discountSchema;
