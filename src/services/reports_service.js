import {
  ok, fail, rows, one
} from './_common.js';

const onlyUAH = filters =>
  filters.currency === 'UAH'
    ? null
    : fail(
        422,
        'Фінансові SQL-звіти підтримують лише UAH'
      );

const finance = filters =>
  one(
    'SELECT * FROM kms_financial_report($1, $2, $3)',
    [
      filters.start_date,
      filters.end_date,
      'accrual'
    ]
  );

export async function getFinanceReport(filters) {
  return onlyUAH(filters) ??
    ok(await finance(filters));
}

export async function getProfitReport(filters) {
  return onlyUAH(filters) ??
    ok(await finance(filters));
}

export async function getGroupsProfitReport(filters) {
  if (!filters) {
    return fail(
      400,
      'Потрібно передати reportFilters із контролера'
    );
  }

  if (onlyUAH(filters)) return onlyUAH(filters);

  return ok(
    await rows(
      `SELECT
         g.id AS group_id,
         g.name,
         f.*
       FROM groups g
       CROSS JOIN LATERAL
         kms_group_financial_report(
           g.id, $1, $2
         ) f
       ORDER BY g.id`,
      [filters.start_date, filters.end_date]
    )
  );
}

export async function getGroupProfitReport(
  groupId,
  filters
) {
  if (!filters) {
    return fail(
      400,
      'Потрібно передати reportFilters із контролера'
    );
  }

  if (onlyUAH(filters)) return onlyUAH(filters);

  return ok(
    await one(
      `SELECT *
       FROM kms_group_financial_report(
         $1, $2, $3
       )`,
      [
        groupId,
        filters.start_date,
        filters.end_date
      ]
    )
  );
}

export async function getExpensesReport(filters) {
  if (onlyUAH(filters)) return onlyUAH(filters);

  return ok(
    await rows(
      `SELECT
         category,
         COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE date BETWEEN $1 AND $2
         AND currency = $3
       GROUP BY category
       ORDER BY category`,
      [
        filters.start_date,
        filters.end_date,
        filters.currency
      ]
    )
  );
}

export async function getRevenueReport(filters) {
  if (onlyUAH(filters)) return onlyUAH(filters);

  const total = await finance(filters);

  return ok({
    revenue: total.revenue
  });
}

export async function getSalariesReport(filters) {
  if (onlyUAH(filters)) return onlyUAH(filters);

  return ok(
    await rows(
      `SELECT
         employee_id,
         COALESCE(SUM(net_salary), 0) AS total
       FROM salaries
       WHERE period_start >= $1
         AND period_end <= $2
         AND currency = $3
       GROUP BY employee_id
       ORDER BY employee_id`,
      [
        filters.start_date,
        filters.end_date,
        filters.currency
      ]
    )
  );
}

export const getBreakEvenReport = () =>
  fail(
    501,
    'Для break-even бракує вхідних параметрів прогнозу в маршруті'
  );

export async function getDashboardReport(filters) {
  if (onlyUAH(filters)) return onlyUAH(filters);

  const summary = await finance(filters);

  const counts = await one(
    `SELECT
       (SELECT COUNT(*) FROM children) AS children,
       (SELECT COUNT(*) FROM groups) AS groups,
       (SELECT COUNT(*) FROM employees) AS employees`
  );

  return ok({
    ...summary,
    counts
  });
}