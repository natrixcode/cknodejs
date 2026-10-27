import {
  ok, missing, list, byId, create,
  patch, rows, one, transaction
} from './_common.js';

const fields = ['name', 'description'];

export const getSubjects = () => list('subjects');

export const getSubjectById = id =>
  byId('subjects', id);

export const createSubject = data =>
  create('subjects', data, fields);

export const updateSubject = (id, data) =>
  patch('subjects', id, data, fields);

export async function getSubjectTeachers(id) {
  return ok(
    await rows(
      `SELECT e.*
       FROM employees e
       JOIN employee_subjects es
         ON es.employee_id = e.id
       WHERE es.subject_id = $1
       ORDER BY e.id`,
      [id]
    )
  );
}

export async function updateSubjectTeachers(id, data) {
  return transaction(async db => {
    const subject = await one(
      'SELECT id FROM subjects WHERE id = $1 FOR UPDATE',
      [id],
      db
    );

    if (!subject) return missing();

    await rows(
      'DELETE FROM employee_subjects WHERE subject_id = $1',
      [id],
      db
    );

    await rows(
      `INSERT INTO employee_subjects(
         employee_id, subject_id
       )
       SELECT x, $1
       FROM unnest($2::bigint[]) AS x`,
      [id, [...new Set(data.employee_ids)]],
      db
    );

    return ok(
      await rows(
        `SELECT e.*
         FROM employees e
         JOIN employee_subjects es
           ON es.employee_id = e.id
         WHERE es.subject_id = $1
         ORDER BY e.id`,
        [id],
        db
      )
    );
  });
}