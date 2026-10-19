
import { z } from 'zod';

export const scheduleSchema = z.object({
    date: z.iso.date(),
    startTime: z.iso.time(),
    endTime: z.iso.time(),
    groupId: z.number().int().positive(),
    employeeId: z.number().int().positive(),
    roomId: z.number().int().positive(),
    subjectId: z.number().int().positive().optional()
}).refine(
    data => data.startTime < data.endTime,
    {
        path: ['endTime'],
        error: 'Час завершення має бути пізніше часу початку'
    }
);


