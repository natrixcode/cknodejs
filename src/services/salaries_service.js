import {
  ok, list, byId, rows, one
} from './_common.js';

export const getSalaries = () =>
  list('salaries');

export const getSalaryById = id =>
  byId('salaries', id);

export async function calculateSalary(data) {
  const result = await one(
    `SELECT kms_calculate_employee_salary(
      $1, $2
    ) AS calculated_base_salary`,
    [
      data.employee_id,
      data.period_start
    ]
  );

  return ok({
    ...result,
    employee_id: data.employee_id,
    period_start: data.period_start,
    period_end: data.period_end,
    bonus: data.bonus,
    deductions: data.deductions,
    note:
      'Результат попереднього розрахунку; запис salaries не створено'
  });
}

export async function getEmployeeSalaries(employeeId) {
  return ok(
    await rows(
      `SELECT *
       FROM salaries
       WHERE employee_id = $1
       ORDER BY period_start DESC`,
      [employeeId]
    )
  );
}