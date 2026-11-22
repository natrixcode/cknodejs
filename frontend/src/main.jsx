import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { AttendanceActions, ScheduleActions } from './DayActions.jsx';
import { ListContent, todayInKyiv, useList, useResource } from './shared.jsx';
import { ChildrenPage } from './admin/ChildrenPage.jsx';
import { ParentsPage } from './admin/ParentsPage.jsx';
import './styles.css';

const SESSION_KEY = 'cknodejs.manager.session';
const KYIV = 'Europe/Kyiv';

const timeFormatter = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function formatTime(timestamp) {
  return timeFormatter.format(new Date(timestamp));
}

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));

    if (
      saved?.token &&
      Date.parse(saved.expires_at) > Date.now()
    ) {
      return saved;
    }
  } catch {
    // Якщо браузер заборонив сховище, можна увійти у поточній вкладці.
  }

  return null;
}

function Login({ onLogin, notice }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const identifier = form.get('identifier').trim();
    const field = identifier.includes('@') ? 'email' : 'username';

    setBusy(true);
    setError('');

    try {
      const session = await api('/auth/login', {
        method: 'POST',
        body: {
          [field]: identifier,
          password: form.get('password')
        }
      });

      onLogin(session);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-cover">
        <span className="brand">СК Садок</span>

        <div>
          <h1>Кабінет садочка</h1>
        </div>
      </section>

      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Вхід у кабінет</h2>

          <label>
            Логін або електронна пошта
            <input
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>

          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {(error || notice) && (
            <p className="alert" role="alert">{error || notice}</p>
          )}

          <button className="primary" disabled={busy}>
            {busy ? 'Входимо…' : 'Увійти'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Groups({ token, onExpired, onSelect, title }) {
  const groups = useList('/groups', token, onExpired);

  return (
    <>
      <p className="eyebrow">{title}</p>
      <h1>Групи садочка</h1>
      <p className="muted">Вибери групу, щоб переглянути її день.</p>

      <ListContent state={groups} empty="У базі поки немає груп.">
        {(items) => (
          <div className="group-grid">
            {items.map((group) => (
              <button
                className="group-card"
                key={group.id}
                onClick={() => onSelect(group)}
              >
                <strong>{group.name}</strong>
                <span>Вік дітей у роках: {group.age_years}</span>
                <span>Місць у групі: {group.max_capacity}</span>
              </button>
            ))}
          </div>
        )}
      </ListContent>
    </>
  );
}

function eventName(event) {
  if (event.type === 'lesson') return 'Заняття';
  if (event.kind === 'meal') return 'Харчування';
  if (event.kind === 'nap') return 'Денний сон';
  return 'Режимний блок';
}

function attendanceLabel(record) {
  if (record?.present === true) return 'Присутність';
  if (record?.present === false) return 'Відсутність';
  return 'Без відмітки';
}

function GroupDay({ group, role, token, onExpired, onBack }) {
  const [date, setDate] = useState(todayInKyiv);
  const today = todayInKyiv();
  const future = date > today;
  const query = new URLSearchParams({ group_id: group.id, date });

  const roster = useList(
    `/groups/${group.id}/children`,
    token,
    onExpired
  );

  const schedule = useList(
    date ? `/schedule/overview?${query}` : null,
    token,
    onExpired
  );

  const attendance = useList(
    date && !future ? `/attendance?${query}` : null,
    token,
    onExpired
  );

  return (
    <>
      {onBack && <button className="back" onClick={onBack}>Усі групи</button>}

      <div className="day-heading">
        <div>
          <p className="eyebrow">{onBack ? 'День групи' : 'Моя група'}</p>
          <h1>{group.name}</h1>
        </div>

        <label>
          Дата перегляду
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </div>

      {date ? (
        <div className="panels">
          <section className="panel">
            <h2>Розклад дня</h2>
            <p className="muted">Час Києва</p>

            <ListContent
              state={schedule}
              empty="На цей день подій у розкладі немає."
            >
              {(items) => (
                <ul>
                  {items.map((event) => (
                    <li key={`${event.type}-${event.id}`}>
                      <strong>
                        {formatTime(event.start_time)}–{formatTime(event.end_time)}
                      </strong>
                      {' · '}{eventName(event)}
                      {event.type === 'lesson' && (
                        event.status === 'draft' ? ' · Чернетка' : ' · Опубліковано'
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ListContent>
            <ScheduleActions
                key={group.id + ':' + date}
                role={role}
                group={group}
                date={date}
                state={schedule}
                token={token}
                onExpired={onExpired}
            />
          </section>

          <section className="panel">
            <h2>Відвідуваність</h2>

            {future ? (
              <p className="muted">Табель буде доступний у день відвідування.</p>
            ) : (
              <ListContent
                state={attendance}
                empty="За вибрану дату записів відвідуваності немає."
              >
                {(items) => (
                  <ul>
                    {items.map((row) => (
                      <li key={row.child_id}>
                        <strong>{row.first_name} {row.last_name}</strong>
                        <span className="record-status">
                          {attendanceLabel(row.attendance)}
                        </span>
                        {row.attendance?.reason && (
                          <small>{row.attendance.reason}</small>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                </ListContent>
            )}
            <AttendanceActions
              key={group.id + ':' + date}
              role={role}
              date={date}
              today={today}
              state={attendance}
              token={token}
              onExpired={onExpired}
            />
          </section>
        </div>
      ) : (
        <p>Вибери дату для розкладу та табеля.</p>
      )}

      <section className="panel roster">
        <h2>Поточний склад групи</h2>

        <ListContent state={roster} empty="До цієї групи ще не зараховано дітей.">
          {(items) => (
            <ul>
              {items.map((child) => (
                <li key={child.id}>{child.first_name} {child.last_name}</li>
              ))}
            </ul>
          )}
        </ListContent>
      </section>
    </>
  );
}

const invoiceLabels = {
  draft: 'Чернетка',
  issued: 'Виставлено',
  paid: 'Сплачено',
  cancelled: 'Скасовано'
};

const kyivDate = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV
});

function calendarDate(value) {
  return value.split('-').reverse().join('.');
}

function money(amount, currency) {
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency
  }).format(amount);
}

function ParentHome({ parentId, token, onExpired }) {
  const [selected, setSelected] = useState(null);

  const children = useList(
    parentId ? `/parents/${parentId}/children` : null,
    token,
    onExpired
  );

  if (!parentId) {
    return <p>До облікового запису ще не прив’язано профіль батьків.</p>;
  }

  if (selected) {
    return (
      <ParentChildCard
        key={selected.id}
        child={selected}
        parentId={parentId}
        token={token}
        onExpired={onExpired}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <section className="panel">
      <h1>Мої діти</h1>

      <ListContent
        state={children}
        empty="До вашого профілю ще не додано дітей."
      >
        {items => (
          <div className="group-grid">
            {items.map(child => (
              <button
                className="group-card"
                key={child.id}
                onClick={() => setSelected(child)}
              >
                <strong>{child.first_name} {child.last_name}</strong>
              </button>
            ))}
          </div>
        )}
      </ListContent>
    </section>
  );
}

function ParentChildCard({ child, parentId, token, onExpired, onBack }) {
  const today = todayInKyiv();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const invalid = Boolean(from && to && from > to);

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const childPath = `/children/${child.id}`;

  const attendance = useList(
    invalid ? null : `${childPath}/attendance?${query}`,
    token,
    onExpired
  );

  const schedule = useList(`${childPath}/schedule`, token, onExpired);
  const invoices = useList(`/parents/${parentId}/invoices`, token, onExpired);
  const payments = useList(`/parents/${parentId}/payments`, token, onExpired);

  const childInvoices = {
    ...invoices,
    items: invoices.items?.filter(
      item => String(item.child_id) === String(child.id)
    )
  };

  return (
    <>
      <button className="back" onClick={onBack}>До списку дітей</button>
      <h1>{child.first_name} {child.last_name}</h1>

      <div className="panels">
        <section className="panel">
          <h2>Відвідуваність</h2>

          <label>
            Період від
            <input
              type="date"
              value={from}
              onChange={event => setFrom(event.target.value)}
            />
          </label>

          <label>
            Період до
            <input
              type="date"
              value={to}
              onChange={event => setTo(event.target.value)}
            />
          </label>

          {invalid ? (
            <p role="alert">
              Початок періоду має бути до кінцевої дати або збігатися з нею.
            </p>
          ) : (
            <ListContent
              state={attendance}
              empty="За цей період відміток немає."
            >
              {items => (
                <ul>
                  {items.map(row => (
                    <li key={row.attendance_date}>
                      <strong>{calendarDate(row.attendance_date)}</strong>
                      {' · '}{row.present ? 'Присутність' : 'Відсутність'}
                      {row.reason && <small>{row.reason}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </ListContent>
          )}
        </section>

        <section className="panel">
          <h2>Опублікований розклад</h2>
          <p className="muted">Час Києва</p>

          <ListContent
            state={schedule}
            empty="Опублікованих занять поки немає."
          >
            {items => (
              <ul>
                {items.map(lesson => (
                  <li key={lesson.id}>
                    <strong>{lesson.subject_name || 'Заняття'}</strong>
                    <small>
                      {kyivDate.format(new Date(lesson.start_time))}
                      {' · '}
                      {formatTime(lesson.start_time)}–{formatTime(lesson.end_time)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>
      </div>

      <section className="panel roster">
        <h2>Рахунки та платежі</h2>

        <ListContent
          state={childInvoices}
          empty="Для цієї дитини рахунків поки немає."
        >
          {items => (
            <ul>
              {items.map(invoice => {
                const invoicePayments = {
                  ...payments,
                  items: payments.items?.filter(
                    payment => String(payment.invoice_id) === String(invoice.id)
                  )
                };

                return (
                  <li key={invoice.id}>
                    <strong>
                      Рахунок №{invoice.id} · {money(invoice.total_amount, invoice.currency)}
                    </strong>

                    <small>
                      {calendarDate(invoice.period_start)} – {calendarDate(invoice.period_end)}
                      {' · '}{invoiceLabels[invoice.status] || invoice.status}
                    </small>

                    <ListContent
                      state={invoicePayments}
                      empty="Платежів за цим рахунком поки немає."
                    >
                      {entries => (
                        <ul aria-label={`Платежі за рахунком №${invoice.id}`}>
                          {entries.map(payment => (
                            <li key={payment.id}>
                              Платіж · {kyivDate.format(new Date(payment.payment_date))}
                              {' · '}{money(payment.amount, payment.currency)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </ListContent>
                  </li>
                );
              })}
            </ul>
          )}
        </ListContent>
      </section>
    </>
  );
}

function TeacherHome({ token, onExpired }) {
  const lessons = useList('/schedule', token, onExpired);
  return (
    <section className="panel">
      <h1>Мій розклад</h1>
      <p>Час Києва</p>
      <ListContent state={lessons} empty="У вашому розкладі поки немає занять.">
        {items => <ul>{items.map(lesson =>
          <li key={lesson.id}>
            {new Date(lesson.start_time).toLocaleDateString('uk-UA', { timeZone: KYIV })}
            {' · '}{formatTime(lesson.start_time)}–{formatTime(lesson.end_time)}
            {' · Група №'}{lesson.group_id}{' · Кімната №'}{lesson.room_id}
            {lesson.status === 'draft' ? ' · Чернетка' : ' · Опубліковано'}
          </li>
        )}</ul>}
      </ListContent>
    </section>
  );
}
function Finance({ role, token, onExpired }) {
  const children = useList('/children?status=all', token, onExpired);
  const invoices = useList('/invoices', token, onExpired);

  const [childId, setChildId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const admin = role === 'admin';
  const child = children.items?.find(c => String(c.id) === childId);

  const list = {
    ...invoices,
    items: invoices.items?.filter(i => String(i.child_id) === childId)
  };

  async function save(event, paymentInvoice) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const fields = new FormData(form);

    setBusy(true);
    setNotice('');

    try {
      if (paymentInvoice) {
        await api('/payments', {
          token,
          method: 'POST',
          body: {
            invoice_id: Number(paymentInvoice.id),
            amount: Number(fields.get('amount')),
            currency: paymentInvoice.currency,
            method: fields.get('method'),
            transaction_id: fields.get('reference').trim(),
            payment_date: new Date().toISOString()
          }
        });
      } else {
        const start = fields.get('month') + '-01';
        const months = Number(fields.get('months'));

        // Нульовий день наступного періоду — останній день обраного.
        const end = new Date(start + 'T00:00:00Z');
        end.setUTCMonth(end.getUTCMonth() + months, 0);

        await api('/invoices', {
          token,
          method: 'POST',
          body: {
            child_id: Number(childId),
            period_start: start,
            period_end: end.toISOString().slice(0, 10),
            currency: 'UAH',
            parameters: {
              months,
              meal_days: Number(fields.get('days'))
            }
          }
        });
      }

      form.reset();
      setNotice(
        paymentInvoice ? 'Платіж зареєстровано.' : 'Рахунок виставлено.'
      );
      invoices.retry();
    } catch (error) {
      if (error.status === 401) {
        onExpired(error.message);
      } else {
        setNotice(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel roster day-actions">
      <h1>Фінанси</h1>

      <ListContent state={children} empty="У списку поки немає дітей.">
        {items => (
          <label>
            Дитина
            <select
              value={childId}
              disabled={busy}
              onChange={event => {
                setChildId(event.target.value);
                setNotice('');
              }}
            >
              <option value="">Обери дитину</option>
              {items.map(c => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} · №{c.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </ListContent>

      {child && (
        <div key={childId}>
          {admin && child.status !== 'archived' && (
            <details>
              <summary>Виставити рахунок</summary>

              <form onSubmit={event => save(event, null)}>
                <label>
                  Початковий місяць
                  <input name="month" type="month" required />
                </label>

                <label>
                  Період
                  <select name="months">
                    <option value="1">1 місяць</option>
                    <option value="12">12 місяців</option>
                  </select>
                </label>

                <label>
                  Кількість днів харчування
                  <input
                    name="days"
                    type="number"
                    min="0"
                    max="366"
                    step="1"
                    required
                  />
                </label>

                <button disabled={busy}>Створити рахунок</button>
              </form>
            </details>
          )}

          <h2>Рахунки</h2>

          <ListContent state={list} empty="Для цієї дитини рахунків поки немає.">
            {items => (
              <ul>
                {items.map(i => (
                  <li key={i.id}>
                    <strong>
                      Рахунок №{i.id} · {invoiceLabels[i.status] || i.status}
                    </strong>

                    <small>
                      {calendarDate(i.period_start)} – {calendarDate(i.period_end)}
                    </small>

                    <p>
                      Нараховано {money(i.total_amount, i.currency)} ·
                      Сплачено {money(i.paid_amount, i.currency)} ·
                      Залишок {money(i.balance_due, i.currency)}
                    </p>

                    {admin && i.status === 'issued' && Number(i.balance_due) > 0 && (
                      <details>
                        <summary>Зареєструвати оплату</summary>

                        <form onSubmit={event => save(event, i)}>
                          <label>
                            Сума ({i.currency})
                            <input
                              name="amount"
                              type="number"
                              min="0.01"
                              max={i.balance_due}
                              step="0.01"
                              required
                            />
                          </label>

                          <label>
                            Спосіб оплати
                            <select name="method">
                              <option value="cash">Готівка</option>
                              <option value="card">Картка</option>
                              <option value="bank_transfer">Банківський переказ</option>
                              <option value="online">Онлайн</option>
                            </select>
                          </label>

                          <label>
                            Номер квитанції або операції
                            <input
                              name="reference"
                              required
                              maxLength={200}
                              pattern=".*\S.*"
                            />
                          </label>

                          <button disabled={busy}>Зареєструвати платіж</button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </div>
      )}

      <p role="status">{notice}</p>
    </section>
  );
}

const sections = [
  ['groups', 'Групи'],
  ['children', 'Діти'],
  ['parents', 'Батьки'],
  ['finance', 'Фінанси']
];

function Cabinet({ token, onExpired }) {
  const profile = useResource('/auth/me', token, onExpired);
  const [selected, setSelected] = useState(null);
  const [section, setSection] = useState('groups');
  const access = { token, onExpired };

  if (profile.error) return (
    <div role="alert">
      <p className="alert">{profile.error}</p>
      <button onClick={profile.retry}>Спробувати ще раз</button>
    </div>
  );
  const user = profile.data;
  if (!user) return <p role="status">Завантаження профілю…</p>;

  if (user.role === 'admin' || user.role === 'manager') {
    const title = user.role === 'admin'
      ? 'Кабінет адміністратора'
      : 'Кабінет менеджера';

    return (
      <>
        <nav aria-label="Розділи кабінету" className="cabinet-nav">
          {sections.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {section === 'children' ? (
          <ChildrenPage role={user.role} {...access} />
        ) : section === 'parents' ? (
          <ParentsPage {...access} />
        ) : section === 'finance' ? (
          <Finance role={user.role} {...access} />
        ) : selected ? (
          <GroupDay
            group={selected}
            role={user.role}
            onBack={() => setSelected(null)}
            {...access}
          />
        ) : (
          <Groups title={title} onSelect={setSelected} {...access} />
        )}
      </>
    );
  }
  if (user.role === 'parent') return <ParentHome parentId={user.parent_id} {...access} />;
  if (user.role === 'employee' && user.position === 'teacher') return <TeacherHome {...access} />;
  if (user.role === 'employee' && user.position === 'educator') {
    return user.group
      ? <GroupDay group={user.group} role={user.position} {...access} />
      : <p>Вас ще не призначено до групи.</p>;
  }
  return <p>Для цього облікового запису немає доступного кабінету.</p>;
}

function App() {
  const [session, setSession] = useState(restoreSession);
  const [notice, setNotice] = useState('');

  const endSession = useCallback((message = '') => {
    setSession(null);
    setNotice(message);
  }, []);

  useEffect(() => {
    try {
      if (session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // У цій вкладці сесія продовжує працювати в пам’яті.
    }

    if (!session) return;

    const remaining = Date.parse(session.expires_at) - Date.now();
    const timer = setTimeout(
      () => endSession('Час сесії сплив. Увійди знову.'),
      Math.max(0, remaining)
    );

    return () => clearTimeout(timer);
  }, [session, endSession]);

  async function logout() {
    const token = session.token;
    endSession();
    await api('/auth/logout', { method: 'POST', token }).catch(() => {});
  }

  if (!session) {
    return (
      <Login
        notice={notice}
        onLogin={(newSession) => {
          setNotice('');
          setSession(newSession);
        }}
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">СК Садок</span>
        <div>
          <span>{session.user.name || session.user.username}</span>
          <button onClick={logout}>Вийти</button>
        </div>
      </header>

      <main className="workspace">
        <Cabinet key={session.token} token={session.token} onExpired={endSession} />
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);