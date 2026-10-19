
const { z } = require('zod');

const employeeSchema = z.object({
    firstName: z.string().trim().min(2).max(50),
    lastName: z.string().trim().min(2).max(50),
    email: z.email(),
    phone: z.string().trim().min(7).max(20),
    position: z.enum([
        'director',
        'teacher',
        'assistant',
        'cook',
        'nurse',
        'accountant',
        'other'
    ]),
    salary: z.number().finite().min(0).max(100000000),
    status: z.enum(['active', 'inactive', 'on_leave'])
});

module.exports = employeeSchema;
