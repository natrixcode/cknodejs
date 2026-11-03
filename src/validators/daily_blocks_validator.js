import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });

const baseShape = {
  group_id: z.number().int().positive(),
  block_date: z.iso.date(),
  kind: z.enum(['meal', 'nap']),
  start_time: timestampSchema,
  end_time: timestampSchema
};

function kyivDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));

  const values = Object.fromEntries(
    parts.filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function validateBlock(data, ctx) {
  if (data.start_time && data.end_time) {
    const start = Date.parse(data.start_time);
    const end = Date.parse(data.end_time);

    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_time'],
        message: 'Завершення повинно бути пізніше початку'
      });
    }

    if (data.kind) {
      const expected = data.kind === 'meal' ? 30 : 60;

      if (end - start !== expected * 60_000) {
        ctx.addIssue({
          code: 'custom',
          path: ['end_time'],
          message: data.kind === 'meal'
            ? 'Прийом їжі повинен тривати 30 хвилин'
            : 'Сон повинен тривати 60 хвилин'
        });
      }
    }
  }

  if (data.block_date && data.start_time && data.end_time) {
    if (
      kyivDate(data.start_time) !== data.block_date ||
      kyivDate(data.end_time) !== data.block_date
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['block_date'],
        message: 'Дата повинна відповідати часовому інтервалу Europe/Kyiv'
      });
    }
  }
}

export const dailyBlockSchema = z.strictObject(baseShape)
  .superRefine(validateBlock);

export const dailyBlockPatchSchema = z.strictObject(baseShape)
  .partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'Потрібно передати хоча б одне поле'
  })
  .superRefine(validateBlock);
