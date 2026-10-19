const { z } = require('zod');

const authSchema = z.object({
    email: z.email(),
    password: z.string().trim().min(8),
});

module.exports = authSchema;
    
    
