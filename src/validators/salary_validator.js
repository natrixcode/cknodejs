import { z } from 'zod';

export const salarySchema = z.object({
    employeeId: z.number().int().positive(),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    baseSalary: z.number().finite().min(0),
    bonus: z.number().finite().min(0).default(0),
    deductions: z.number().finite().min(0).default(0),
    currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH'),
    parameters: z.record(
        z.string(),
        z.unknown()
    ).default({})
}).refine(
    data => data.periodStart <= data.periodEnd,
    {
        path: ['periodEnd'],
        error: 'Некоректний період виплати'
    }
).refine(
    data => data.deductions <= data.baseSalary + data.bonus,
    {
        path: ['deductions'],
        error: 'Утримання не можуть перевищувати нараховану суму'
    }
);

