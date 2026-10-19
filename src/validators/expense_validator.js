
const { z } = require('zod');

const expenseSchema = z.object({
    name: z.string().trim().min(2).max(150),
    amount: z.number().finite().positive().max(100000000),
    date: z.iso.date(),
    category: z.enum([
        'food',
        'salary',
        'utilities',
        'equipment',
        'education',
        'transport',
        'maintenance',
        'other'
    ]),
    description: z.string().max(1000).optional(),
    currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH')
});

module.exports = expenseSchema;
