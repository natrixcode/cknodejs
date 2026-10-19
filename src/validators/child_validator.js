const { z } = require('zod');

const childSchema = z.object({
    name: z.string().min(2),
    surname: z.string().min(3),
    birthday: z.data(),
    id: z.number().positive().int()
});

module.exports = childSchema;

    
    
