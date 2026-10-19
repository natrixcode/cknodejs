import { z } from 'zod';

export const settingsSchema = z.object({
    institutionName: z.string().trim().min(2).max(150),
    email: z.email(),
    phone: z.string().trim().min(7).max(20),
    educationalYear: z.string()
        .regex(/^\d{4}-\d{4}$/, 'Формат року: YYYY-YYYY')
        .refine(
            year => {
                const [start, end] = year.split('-').map(Number);
                return end === start + 1;
            },
            { error: 'Навчальний рік має складатися з двох послідовних років' }
        ),
    currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH'),
    timezone: z.string().min(1).max(100),
    settings: z.record(
        z.string(),
        z.unknown()
    ).default({})
});

