import { useState } from 'react';
import { api } from '../api.js';
import { useList, todayInKyiv } from '../shared.jsx';

const dates = ['start_date', 'end_date'];

// Назва, HTTP-метод, маршрут API, поля форми, постійні параметри.
const operations = [
  ['Тарифи навчання', 'GET', '/tuition/rates'],
  ['Новий тариф навчання', 'POST', '/tuition/rates',
    ['amount', 'valid_from'], { currency: 'UAH', billing_period: 'monthly' }],

  ['Тарифи харчування', 'GET', '/food/rates'],
  ['Новий тариф харчування', 'POST', '/food/rates',
    ['age_years', 'price_per_day', 'valid_from']],

  ['Довідник пільг', 'GET', '/discounts'],
  ['Створити пільгу', 'POST', '/discounts',
    ['name', 'percentage', 'valid_from']],
  ['Пільги дитини', 'GET', '/discounts/:child/discounts', ['child']],
  ['Призначити пільгу', 'POST', '/discounts/:child/discounts',
    ['child', 'discount_id']],
  ['Відкликати пільгу', 'DELETE', '/discounts/:child/discounts/:discount_id',
    ['child', 'discount_id']],
  ['Скасувати рахунок', 'POST', '/invoices/:invoice/cancel', ['invoice']],

  ['Нараховані зарплати', 'GET', '/salaries'],
  ['Попередній розрахунок зарплати', 'POST', '/salaries/calculate',
    ['employee_id', 'month']],
  ['Нарахувати зарплату', 'POST', '/salaries', ['employee_id', 'month']],
  ['Перелік витрат', 'GET', '/expenses'],
  ['Зареєструвати витрату', 'POST', '/expenses',
    ['name', 'amount', 'date', 'category'], { currency: 'UAH' }],

  ['Фінансовий результат', 'GET', '/reports/finance', dates],
  ['Прибуток груп', 'GET', '/reports/profit/groups', dates],
  ['Витрати за категоріями', 'GET', '/reports/expenses', dates],
  ['Зарплати за працівниками', 'GET', '/reports/salaries', dates],
  ['Прогноз беззбитковості', 'GET', '/reports/break-even',
    ['age', 'available_rooms', 'meal_days', 'food_cost_per_day', 'discount_percent']],

  ['Поточний навчальний рік', 'GET', '/settings/academic-year'],
  ['Змінити навчальний рік', 'PUT', '/settings/academic-year', ['educational_year']],
  ['Історія запису', 'GET', '/history', ['table', 'id']]
];

const labels = {
  child: 'Дитина',
  discount_id: 'Пільга',
  invoice: 'Рахунок',
  employee_id: 'Працівник',
  amount: 'Сума, грн',
  valid_from: 'Діє з',
  age_years: 'Вік дитини',
  age: 'Вік дітей',
  price_per_day: 'Ціна за день, грн',
  name: 'Назва',
  percentage: 'Пільга, %',
  month: 'Місяць нарахування',
  date: 'Дата витрати',
  category: 'Категорія',
  start_date: 'Період від',
  end_date: 'Період до',
  available_rooms: 'Доступні кімнати',
  meal_days: 'Днів харчування',
  food_cost_per_day: 'Собівартість харчування на дитину за день, грн',
  discount_percent: 'Середня знижка, %',
  educational_year: 'Навчальний рік',
  table: 'Таблиця',
  id: 'Номер запису',
  revenue: 'Дохід за нарахуванням',
  payroll_cost: 'Зарплати',
  other_expenses: 'Інші витрати',
  operating_profit: 'Операційний прибуток',
  room_model_cost: 'Умовна вартість кімнат',
  modeled_profit: 'Модельний прибуток',
  group_revenue: 'Дохід групи',
  direct_salary_cost: 'Прямі зарплатні витрати',
  direct_profit: 'Прямий прибуток',
  net_salary: 'До виплати',
  reachable: 'Беззбитковість досяжна',
  calculated_base_salary: 'Розрахована зарплата',
  monthly_revenue: 'Місячний дохід',
  children_count: 'Кількість дітей',
  group_count: 'Кількість груп',
  message: 'Пояснення'
};

const ranges = {
  age: [2, 5, 1],
  age_years: [2, 5, 1],
  available_rooms: [1, 20, 1],
  meal_days: [0, 31, 1],
  discount_percent: [0, 30, 0.01],
  food_cost_per_day: [0, 100000, 0.01],
  price_per_day: [0, 99999999.99, 0.01],
  amount: [0, 100000000, 0.01]
};

const sources = {
  child: '/children',
  discount_id: '/discounts',
  invoice: '/invoices',
  employee_id: '/employees'
};

const categories = {
  food: 'Харчування',
  salary: 'Зарплата',
  utilities: 'Комунальні',
  equipment: 'Обладнання',
  education: 'Навчання',
  transport: 'Транспорт',
  maintenance: 'Ремонт',
  other: 'Інше'
};

const tables = [
  'children', 'parents', 'groups', 'employees', 'schedule',
  'attendance', 'invoices', 'payments', 'expenses', 'salaries', 'settings'
];
function Lookup({ field, token, onExpired }) {
  const list = useList(sources[field], token, onExpired);

  if (list.error) {
    return (
      <span role="alert">
        {list.error}{' '}
        <button type="button" onClick={list.retry}>Повторити</button>
      </span>
    );
  }

  return (
    <select name={field} required defaultValue="">
      <option value="">
        {list.items ? 'Обери запис' : 'Завантаження…'}
      </option>

      {(list.items || []).map(row => {
        const description = row.name ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          [row.period_start, row.total_amount, row.currency, row.status].join(' ');

        return (
          <option key={row.id} value={row.id}>
            №{row.id} · {description}
          </option>
        );
      })}
    </select>
  );
}

function Field({ field, token, onExpired }) {
  if (sources[field]) {
    return <Lookup field={field} token={token} onExpired={onExpired} />;
  }

  if (['category', 'percentage', 'table'].includes(field)) {
    const entries = field === 'category'
      ? Object.entries(categories)
      : (field === 'table' ? tables : [10, 20, 30]).map(value => [value, value]);

    return (
      <select name={field}>
        {entries.map(([value, title]) => (
          <option key={value} value={value}>{title}</option>
        ))}
      </select>
    );
  }

  if (ranges[field]) {
    const [min, max, step] = ranges[field];
    return <input name={field} type="number" min={min} max={max} step={step} required />;
  }

  if (field === 'month') {
    return <input type="month" name={field} required />;
  }

  if (['date', 'start_date', 'end_date', 'valid_from'].includes(field)) {
    const today = todayInKyiv();
    const first = today.slice(0, 7) + '-01';
    const last = new Date(first + 'T00:00:00Z');
    last.setUTCMonth(last.getUTCMonth() + 1, 0);

    let value = today;
    if (field === 'start_date') value = first;
    if (field === 'end_date') value = last.toISOString().slice(0, 10);

    return <input type="date" name={field} defaultValue={value} required />;
  }

  return (
    <input
      name={field}
      required
      placeholder={field === 'educational_year' ? '2026-2027' : undefined}
    />
  );
}

function Result({ value }) {
  if (value == null) return <span>—</span>;

  if (Array.isArray(value)) {
    if (!value.length) return <p>Записів немає.</p>;

    return (
      <ol>
        {value.map((item, index) => (
          <li key={item?.id ?? index}><Result value={item} /></li>
        ))}
      </ol>
    );
  }

  if (typeof value === 'object') {
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt><strong>{labels[key] || key}</strong></dt>
            <dd><Result value={item} /></dd>
          </div>
        ))}
      </dl>
    );
  }

  if (typeof value === 'boolean') return <span>{value ? 'Так' : 'Ні'}</span>;
  return <span>{String(value)}</span>;
}
export default function OfficePage({ token, onExpired }) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(undefined);

  const [title, method, template, fields = [], defaults = {}] = operations[index];

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    setError('');
    setResult(undefined);
    setBusy(true);

    try {
      let path = template;
      const values = { ...defaults };

      for (const field of fields) {
        const raw = String(form.get(field) ?? '').trim();
        if (!raw) throw new Error('Заповни поле «' + labels[field] + '».');

        if (path.includes(':' + field)) {
          path = path.replace(':' + field, encodeURIComponent(raw));
        } else {
          const numeric = ranges[field] || ['employee_id', 'percentage'].includes(field);
          values[field] = numeric ? Number(raw) : raw;
        }
      }

      if (values.start_date > values.end_date) {
        throw new Error('Перевір порядок дат.');
      }

      if (values.month) {
        values.period_start = values.month + '-01';
        delete values.month;

        if (path.endsWith('/calculate')) {
          const last = new Date(values.period_start + 'T00:00:00Z');
          last.setUTCMonth(last.getUTCMonth() + 1, 0);
          values.period_end = last.toISOString().slice(0, 10);

          // Обов’язкове поле валідатора. Фактичну ставку обчислює SQL.
          values.base_salary = 0;
        }
      }

      if (method === 'DELETE' || path.endsWith('/cancel')) {
        if (!window.confirm(title + ' для вибраного запису?')) return;
      }

      const query = new URLSearchParams(values).toString();
      const url = method === 'GET' && query ? path + '?' + query : path;

      const response = await api(url, {
        token,
        method,
        body: method === 'GET' || method === 'DELETE' ? undefined : values
      });

      setResult(response ?? 'Операцію виконано.');
    } catch (err) {
      if (err.status === 401) onExpired(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel roster day-actions">
      <h1>Управління садочком</h1>

      <label>
        Операція
        <select
          value={index}
          disabled={busy}
          onChange={event => {
            setIndex(Number(event.target.value));
            setResult(undefined);
            setError('');
          }}
        >
          {operations.map(([name], i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
      </label>

      <form key={title} onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>{title}</legend>

          {fields.map(field => (
            <label key={field}>
              {labels[field]}
              <Field field={field} token={token} onExpired={onExpired} />
            </label>
          ))}

          <button>
            {busy ? 'Зачекай…' : method === 'GET' ? 'Показати' : title}
          </button>
        </fieldset>
      </form>

      {error && <p role="alert">{error}</p>}

      {result !== undefined && (
        <section aria-live="polite">
          <h2>Результат</h2>
          <Result value={result} />
        </section>
      )}
    </section>
  );
}