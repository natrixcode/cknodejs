import { pool } from '../config/database.js';

const isValidId = (id) =>
  typeof id === 'string' &&
  /^[1-9]\d*$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;


const roundMoney = (value) => Number(Number(value).toFixed(2));

async function loadRevenue({ start_date, end_date, currency }) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::integer AS payment_count,
       COALESCE(SUM(amount), 0)::numeric(14,2) AS total
     FROM payments
     WHERE currency = $1
       AND (payment_date AT TIME ZONE 'Europe/Kyiv')::date
           BETWEEN $2::date AND $3::date`,
    [currency, start_date, end_date]
  );

  return result.rows[0];
}

async function loadExpenses({ start_date, end_date, currency }) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::integer AS expense_count,
       COALESCE(SUM(amount), 0)::numeric(14,2) AS total
     FROM expenses
     WHERE currency = $1
       AND date BETWEEN $2::date AND $3::date`,
    [currency, start_date, end_date]
  );

  return result.rows[0];
}

async function loadSalaries({ start_date, end_date, currency }) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::integer AS salary_count,
       COALESCE(SUM(base_salary), 0)::numeric(14,2) AS base_total,
       COALESCE(SUM(bonus), 0)::numeric(14,2) AS bonus_total,
       COALESCE(SUM(deductions), 0)::numeric(14,2) AS deductions_total,
       COALESCE(SUM(net_salary), 0)::numeric(14,2) AS net_total
     FROM salaries
     WHERE currency = $1
       AND period_end BETWEEN $2::date AND $3::date`,
    [currency, start_date, end_date]
  );

  return result.rows[0];
}

async function loadFinance(filters) {
  const [revenue, expenses, salaries] = await Promise.all([
    loadRevenue(filters),
    loadExpenses(filters),
    loadSalaries(filters)
  ]);

  return {
    period: {
      start_date: filters.start_date,
      end_date: filters.end_date
    },
    currency: filters.currency,
    revenue: {
      payment_count: revenue.payment_count,
      total: revenue.total
    },
    expenses: {
      expense_count: expenses.expense_count,
      total: expenses.total
    },
    salaries: {
      salary_count: salaries.salary_count,
      accrued_net_total: salaries.net_total
    },
    operating_cash_surplus: roundMoney(
      Number(revenue.total) - Number(expenses.total)
    ).toFixed(2)
  };
}

export async function getFinanceReport(reportFilters) {
  try {
    const report = await loadFinance(reportFilters);

    return { status: 200, body: report };
  } catch (error) {
    throw error;
  }
}

export async function getProfitReport(reportFilters) {
  try {
    const report = await loadFinance(reportFilters);

    return { status: 200, body: {
      period: report.period,
      currency: report.currency,
      recognized_cash_revenue: report.revenue.total,
      recorded_expenses: report.expenses.total,
      operating_cash_surplus: report.operating_cash_surplus,
      accounting_profit_calculated: false,
      note: 'Cash receipts minus recorded expenses; not accounting profit'
    } };
  } catch (error) {
    throw error;
  }
}

export async function getGroupsProfitReport() {
  return { status: 501, body: {
    message: 'Group profit requires agreed expense allocation rules'
  } };
}

export async function getGroupProfitReport(groupId) {
  try {

    if (!isValidId(groupId)) {
      return { status: 400, body: {
        message: 'Invalid group ID'
      } };
    }

    const result = await pool.query(
      'SELECT id FROM groups WHERE id = $1',
      [groupId]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: {
        message: 'Group not found'
      } };
    }

    return { status: 501, body: {
      message: 'Group profit requires historical group membership and expense allocation'
    } };
  } catch (error) {
    throw error;
  }
}

export async function getExpensesReport(reportFilters) {
  try {
    const filters = reportFilters;

    const result = await pool.query(
      `SELECT
         category,
         COUNT(*)::integer AS expense_count,
         COALESCE(SUM(amount), 0)::numeric(14,2) AS total
       FROM expenses
       WHERE currency = $1
         AND date BETWEEN $2::date AND $3::date
       GROUP BY category
       ORDER BY category`,
      [filters.currency, filters.start_date, filters.end_date]
    );

    return { status: 200, body: {
      period: {
        start_date: filters.start_date,
        end_date: filters.end_date
      },
      currency: filters.currency,
      categories: result.rows,
      total: roundMoney(
        result.rows.reduce(
          (sum, row) => sum + Number(row.total),
          0
        )
      ).toFixed(2)
    } };
  } catch (error) {
    throw error;
  }
}

export async function getRevenueReport(reportFilters) {
  try {
    const filters = reportFilters;
    const revenue = await loadRevenue(filters);

    const result = await pool.query(
      `SELECT
         (payment_date AT TIME ZONE 'Europe/Kyiv')::date AS date,
         COUNT(*)::integer AS payment_count,
         COALESCE(SUM(amount), 0)::numeric(14,2) AS total
       FROM payments
       WHERE currency = $1
         AND (payment_date AT TIME ZONE 'Europe/Kyiv')::date
             BETWEEN $2::date AND $3::date
       GROUP BY (payment_date AT TIME ZONE 'Europe/Kyiv')::date
       ORDER BY date`,
      [filters.currency, filters.start_date, filters.end_date]
    );

    return { status: 200, body: {
      period: {
        start_date: filters.start_date,
        end_date: filters.end_date
      },
      currency: filters.currency,
      payment_count: revenue.payment_count,
      total: revenue.total,
      daily_revenue: result.rows
    } };
  } catch (error) {
    throw error;
  }
}

export async function getSalariesReport(reportFilters) {
  try {
    const filters = reportFilters;
    const totals = await loadSalaries(filters);

    const result = await pool.query(
      `SELECT
         s.employee_id,
         e.first_name,
         e.last_name,
         COUNT(s.id)::integer AS salary_count,
         COALESCE(SUM(s.net_salary), 0)::numeric(14,2) AS net_total
       FROM salaries s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.currency = $1
         AND s.period_end BETWEEN $2::date AND $3::date
       GROUP BY s.employee_id, e.first_name, e.last_name
       ORDER BY e.last_name, e.first_name, s.employee_id`,
      [filters.currency, filters.start_date, filters.end_date]
    );

    return { status: 200, body: {
      period: {
        start_date: filters.start_date,
        end_date: filters.end_date
      },
      currency: filters.currency,
      totals,
      employees: result.rows,
      note: 'Accrued salaries grouped by period end date'
    } };
  } catch (error) {
    throw error;
  }
}

export async function getBreakEvenReport() {
  return { status: 501, body: {
    message: 'Break-even calculation requires fixed and variable cost rules'
  } };
}

export async function getDashboardReport(reportFilters) {
  try {
    const filters = reportFilters;

    const [finance, counts] = await Promise.all([
      loadFinance(filters),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::integer FROM children) AS children_count,
           (SELECT COUNT(*)::integer FROM groups) AS groups_count,
           (SELECT COUNT(*)::integer FROM employees) AS employees_count,
           (SELECT COUNT(*)::integer FROM rooms) AS rooms_count`
      )
    ]);

    return { status: 200, body: {
      period: finance.period,
      currency: finance.currency,
      finance: {
        revenue: finance.revenue.total,
        expenses: finance.expenses.total,
        operating_cash_surplus: finance.operating_cash_surplus
      },
      current_counts: counts.rows[0],
      note: 'Current counts are not historical period snapshots'
    } };
  } catch (error) {
    throw error;
  }
}
