import { z } from 'zod';
export const groupSchema = z.object({
  name: z.string().trim().min(1, 'Вкажіть назву групи'),
  children_count: z.coerce.number().int()
    .min(0)
    .max(20, 'У групі не може бути більше 20 дітей'),
  min_age: z.coerce.number().min(2).max(5),
  max_age: z.coerce.number().min(2).max(5),
}).refine(
  (data) => data.min_age <= data.max_age,
  {
    message: 'Мінімальний вік не може перевищувати максимальний',
    path: ['min_age'],
  }
);
