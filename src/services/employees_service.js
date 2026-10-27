import {
  ok, missing, list, byId, create,
  patch, rows, one, transaction
} from './_common.js';

const fields = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'position',
  'salary',
  'status'
];

export const getEmployees = () => list('employees');

export const getEmployeeById = id =>
  byId('employees', id);

export const createEmployee = data =>
  create('employees', data, fields);

export const updateEmployee = (id, data) =>
  patch('employees', id, data, fields);

export const updateEmployeeStatus = (id, data) =>
  patch('employees', id, data, ['status']);

export async function getEmployeeGroups(id) {
  return ok(
    await rows(
      `SELECT g.*, gs.role AS staff_role
       FROM groups g
       JOIN group_staff gs
         ON gs.group_id = g.id
       WHERE gs.employee_id = $1
       ORDER BY g.id`,
      [id]
    )
  );
}

export async function getEmployeeSubjects(id) {
  return ok(
    await rows(
      `SELECT s.*
       FROM subjects s
       JOIN employee_subjects es
         ON es.subject_id = s.id
       WHERE es.employee_id = $1
       ORDER BY s.id`,
      [id]
    )
  );
}

export async function updateEmployeeSubjects(id, data) {
  return transaction(async db => {
    const employee = await one(
      'SELECT id FROM employees WHERE id = $1 FOR UPDATE',
      [id],
      db
    );

    if (!employee) return missing();

    await rows(
      'DELETE FROM employee_subjects WHERE employee_id = $1',
      [id],
      db
    );

    await rows(
      `INSERT INTO employee_subjects(
         employee_id, subject_id
       )
       SELECT $1, x
       FROM unnest($2::bigint[]) AS x`,
      [id, [...new Set(data.subject_ids)]],
      db
    );

    return ok(
      await rows(
        `SELECT s.*
         FROM subjects s
         JOIN employee_subjects es
           ON es.subject_id = s.id
         WHERE es.employee_id = $1
         ORDER BY s.id`,
        [id],
        db
      )
    );
  });
}

export async function getEmployeeSchedule(id) {
  return ok(
    await rows(
      `SELECT *
       FROM schedule
       WHERE teacher_id = $1
       ORDER BY start_time`,
      [id]
    )
  );
}

export async function getEmployeeSalary(id) {
  return ok(
    await one(
      `SELECT kms_calculate_employee_salary(
        $1, CURRENT_DATE
      ) AS amount`,
      [id]
    )
  );
}