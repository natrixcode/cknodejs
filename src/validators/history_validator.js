import { z } from 'zod';

export const historyQuerySchema = z.object({
  table: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'Некоректна назва таблиці'),
  id: z.string().trim().min(1, 'Ідентифікатор обовʼязковий')
});

export const historyStateQuerySchema = z.object({
  table: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'Некоректна назва таблиці'),
  id: z.string().trim().min(1, 'Ідентифікатор обовʼязковий'),
  at: z.string().trim().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Некоректний формат дати або часу'
  })
});

