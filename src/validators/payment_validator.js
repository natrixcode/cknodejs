
const { z } = require('zod');

const paymentSchema = z.object({
    invoiceId: z.number().int().positive(),
    amount: z.number().finite().positive().max(100000000),
    paymentDate: z.iso.datetime(),
    method: z.enum([
        'cash',
        'card',
        'bank_transfer',
        'online'
    ]),
    transactionId: z.string().trim().max(200).optional(),
    currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH')
});

module.exports = paymentSchema;
