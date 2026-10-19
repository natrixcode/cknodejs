import { z } from 'zod';

export const authSchema = z.object({
    email: z.email(),
    password: z.string().trim().min(8),
    role: z.enum([
        'admin',
        'manager',
        'parent',
        'teacher'
    ])
});


    
    
