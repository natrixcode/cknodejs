import { useState } from 'react';
import { api } from './api.js';

const messages = {
  KMS_DAILY_ROUTINE_INCOMPLETE:
    'Для цього дня потрібні три прийоми їжі й один денний сон.',
  KMS_GENERATION_INSUFFICIENT_SUBJECTS:
    'Для генерації потрібно щонайменше три предмети.',
  KMS_GENERATION_NO_AVAILABLE_TEACHER:
    'Для одного з предметів немає вільного викладача з відповідним призначенням.',
  KMS_GENERATION_DAY_EXISTS:
    'На цю дату вже є заняття. Онови розклад.',
  KMS_GROUP_NOT_ACTIVE:
    'Планувати заняття можна для активної групи.',
  KMS_BLOCK_OUTSIDE_WORKDAY:
    'Режимні блоки мають поміститися у вісім годин робочого дня.',
  KMS_CONSECUTIVE_MEALS:
    'Між прийомами їжі потрібна перерва.',
  KMS_ATTENDANCE_PAST_FORBIDDEN:
    'Вихователь може ставити відмітки за сьогодні.'
};

function useAction(onExpired, reload) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function run(task, success) {
    setBusy(true);
    setNotice('');

    try {
      await task();
      setNotice(success);
      reload();
    } catch (error) {
      if (error.status === 401) {
        onExpired(error.message);
      } else {
        setNotice(messages[error.message] || error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return { busy, notice, run };
}

export function AttendanceActions({ role, date, today, state, token, onExpired }) {
  const [child, setChild] = useState('');
  const { busy, notice, run } = useAction(onExpired, state.retry);

  const mark = role === 'educator' && date === today;
  const correct = ['admin', 'manager'].includes(role) && date < today;

  if (!mark && !correct) return null;

  const rows = (state.items || []).filter(row => mark || row.attendance?.id);
  const row = rows.find(item => String(item.child_id) === child);

  function submit(event) {
    event.preventDefault();

    const fields = new FormData(event.currentTarget);
    const present = fields.get('status') === 'yes';
    const body = {
      present,
      reason: present ? null : fields.get('reason')?.trim() || null
    };

    const path = mark ? '/attendance' : '/attendance/' + row.attendance.id;
    if (mark) Object.assign(body, { child_id: child, date });

    run(
      () => api(path, { token, method: mark ? 'POST' : 'PATCH', body }),
      'Відмітку збережено.'
    );
  }

  return (
    <div className="day-actions">
      {rows.length > 0 && (
        <label>
          Дитина для відмітки
          <select
            value={child}
            disabled={busy}
            onChange={event => setChild(event.target.value)}
          >
            <option value="">Обери дитину</option>
            {rows.map(item => (
              <option key={item.child_id} value={item.child_id}>
                {item.first_name} {item.last_name}
              </option>
            ))}
          </select>
        </label>
      )}

      {row && (
        <form key={child} onSubmit={submit}>
          <label>
            Відвідуваність
            <select
              name="status"
              required
              defaultValue={
                row.attendance ? (row.attendance.present ? 'yes' : 'no') : ''
              }
            >
              <option value="">Обери статус</option>
              <option value="yes">Присутність</option>
              <option value="no">Відсутність</option>
            </select>
          </label>

          <label>
            Причина відсутності (за бажанням)
            <input
              name="reason"
              maxLength={1000}
              defaultValue={row.attendance?.reason || ''}
            />
          </label>

          <button disabled={busy}>Зберегти відмітку</button>
        </form>
      )}

      <p role="status">{notice}</p>
    </div>
  );
}

const kyivOffset = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  timeZoneName: 'longOffset'
});

function offsetAt(instant) {
  const part = kyivOffset.formatToParts(instant)
    .find(item => item.type === 'timeZoneName');

  return part.value.replace('GMT', '') || '+00:00';
}

function kyivStart(day, clock) {
  // У день переведення годинника ранковий і денний зсуви можуть відрізнятися.
  for (const hour of ['12:00', '00:00']) {
    const offset = offsetAt(new Date(day + 'T' + hour + ':00Z'));
    const start = new Date(day + 'T' + clock + ':00' + offset);

    if (offsetAt(start) === offset) return start;
  }

  throw new Error('Такого місцевого часу в Києві цього дня немає.');
}

export function ScheduleActions({ role, group, date, state, token, onExpired }) {
  const { busy, notice, run } = useAction(onExpired, state.retry);
  const admin = role === 'admin';

  if (!admin && role !== 'manager') return null;

  const lessons = (state.items || []).filter(event => event.type === 'lesson');
  const drafts = lessons.filter(event => event.status === 'draft');
  const locked = busy || !state.items;

  function post(path, body) {
    return api(path, { token, method: 'POST', body });
  }

  function addBlock(event) {
    event.preventDefault();

    const fields = new FormData(event.currentTarget);
    const kind = fields.get('kind');

    run(() => {
      const start = kyivStart(date, fields.get('clock'));
      const minutes = kind === 'meal' ? 30 : 60;
      const end = new Date(start.getTime() + minutes * 60000);

      return post('/daily-blocks', {
        group_id: Number(group.id),
        block_date: date,
        kind,
        start_time: start.toISOString(),
        end_time: end.toISOString()
      });
    }, 'Режимний блок додано.');
  }

  function generate() {
    run(
      () => post('/schedule/generate', { group_id: Number(group.id), date }),
      'Чернетку дня створено.'
    );
  }

  function publish(event) {
    event.preventDefault();

    const start = new FormData(event.currentTarget).get('start');

    run(
      () => post('/schedule/publish', {
        schedule_ids: drafts.map(event => String(event.id)),
        day_start: start
      }),
      'Розклад дня опубліковано.'
    );
  }

  return (
    <div className="day-actions">
      {admin && (
        <details>
          <summary>Додати харчування або сон</summary>

          <form onSubmit={addBlock}>
            <label>
              Тип блоку
              <select name="kind">
                <option value="meal">Харчування · 30 хв</option>
                <option value="nap">Денний сон · 60 хв</option>
              </select>
            </label>

            <label>
              Початок за Києвом
              <input name="clock" type="time" required defaultValue="08:00" />
            </label>

            <button disabled={locked}>Додати блок</button>
          </form>
        </details>
      )}

      <button disabled={locked || lessons.length > 0} onClick={generate}>
        Згенерувати чернетку дня
      </button>

      {admin && drafts.length > 0 && (
        <form onSubmit={publish}>
          <label>
            Початок робочого дня
            <input name="start" type="time" defaultValue="08:00" required />
          </label>

          <button disabled={locked}>
            Опублікувати всі чернетки дня ({drafts.length})
          </button>
        </form>
      )}

      <p role="status">{notice}</p>
    </div>
  );
}