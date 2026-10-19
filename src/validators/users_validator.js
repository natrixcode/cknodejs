const { z } = require('zod');

const userSchema = z.object({
    name: z.string().min(2),
    email: z.email(),
    password: z.string().min(8),
       role: z.enum([
        'admin',
        'user',
        'moderator'
    ]),

    status: z.enum([
        'active',
        'inactive',
        'blocked',
        'pending'
    ])
});

module.exports = userSchema;

    
    
