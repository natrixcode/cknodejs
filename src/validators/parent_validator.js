import { z } from 'zod';

export const parentSchema = z.object({
    name: z.string().min(2),
    surname: z.string().min(3),
    email: z.email(),
    phone: z.string().min(7).max(10)
});


    
    
