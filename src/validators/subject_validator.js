
const { z } = require('zod');

const subjectSchema = z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().max(1000).optional(),
    employeeIds: z.array(
        z.number().int().positive()
    ).min(1).max(100)
        .refine(
            ids => new Set(ids).size === ids.length,
            { error: 'ID працівників не повинні повторюватися' }
        )
});

module.exports = subjectSchema;
