import { z } from 'zod';

export const roomSchema = z.object({
    name: z.string().trim().min(1).max(50),
    capacity: z.number().int().min(1).max(500),
    status: z.enum([
        'available',
        'occupied',
        'maintenance',
        'inactive'
    ])
});


