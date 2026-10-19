const { z } = require('zod');

const groupSchema = z.object({
    name: z.string().trim().min(2, 'Назва має містити мінімум 2 символи').max(50, 'Назва не може бути довшою за 50 символів'),
    capacity: z.number().int().min(1, 'Місткість має бути не меншою за 1').max(100, 'Місткість не може перевищувати 100'),
    minAge: z.number().int().min(0).max(100),
    maxAge: z.number().int().min(0).max(100)
}).refine(
    data => data.minAge <= data.maxAge,
    {
        path: ['maxAge'],
        error: 'Максимальний вік не може бути меншим за мінімальний'
    }
);

module.exports = groupSchema;