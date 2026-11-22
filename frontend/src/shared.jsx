import { useEffect, useState } from 'react';
import { api } from './api.js';

// Спільні інструменти для всіх розділів кабінету:
// завантаження даних, стани «завантаження / помилка / порожньо»
// і виконання дій (створити, змінити, архівувати).

const KYIV = 'Europe/Kyiv';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function todayInKyiv() {
  const parts = dateFormatter.formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;

  return `${value('year')}-${value('month')}-${value('day')}`;
}

// 2024-03-05 → 05.03.2024
export function calendarDate(value) {
  return value ? value.slice(0, 10).split('-').reverse().join('.') : '';
}

// Повних років на сьогодні за Києвом.
export function ageInYears(dateOfBirth, today = todayInKyiv()) {
  const [year, month, day] = dateOfBirth.slice(0, 10).split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = today.split('-').map(Number);

  let age = nowYear - year;
  if (nowMonth < month || (nowMonth === month && nowDay < day)) age -= 1;

  return age;
}

// Кожна секція завантажується окремо. При зміні адреси попередній
// запит скасовується, щоб його відповідь не потрапила в нову секцію.
export function useResource(path, token, onExpired, expectList = false) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();

    async function load() {
      try {
        const data = await api(path, {
          token,
          signal: controller.signal
        });

        if (expectList && !Array.isArray(data)) {
          throw new Error('API повернув неочікуваний формат списку.');
        }

        if (!controller.signal.aborted) {
          setResult({ path, attempt, data });
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        if (error.status === 401) {
          onExpired(error.message);
        } else {
          setResult({ path, attempt, error: error.message });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [path, token, attempt, onExpired, expectList]);

  const current =
    result?.path === path && result?.attempt === attempt ? result : null;

  return {
    ...current,
    retry: () => setAttempt((previous) => previous + 1)
  };
}

export function useList(path, token, onExpired) {
  const { data, ...state } = useResource(path, token, onExpired, true);
  return { ...state, items: data };
}

export function ListContent({ state, empty, children }) {
  if (state.error) {
    return (
      <div role="alert">
        <p className="alert">{state.error}</p>
        <button onClick={state.retry}>Спробувати ще раз</button>
      </div>
    );
  }

  if (!state.items) return <p role="status">Завантаження…</p>;
  if (state.items.length === 0) return <p className="muted">{empty}</p>;

  return children(state.items);
}

// Виконує дію над даними: блокує кнопки на час запиту,
// показує результат і пояснення помилки.
export function useMutation(onExpired) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function run(task, success, after) {
    if (busy) return false;

    setBusy(true);
    setNotice(null);

    try {
      const result = await task();
      setNotice({ type: 'ok', text: success });
      after?.(result);
      return true;
    } catch (error) {
      if (error.status === 401) {
        onExpired(error.message);
      } else {
        setNotice({ type: 'error', text: error.message });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, notice, run, clear: () => setNotice(null) };
}

export function Notice({ notice }) {
  if (!notice) return null;

  return notice.type === 'error'
    ? <p className="alert" role="alert">{notice.text}</p>
    : <p className="success" role="status">{notice.text}</p>;
}

// Порожній рядок у формі означає «не вказано».
export function optionalText(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}
