import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import './styles.css';

const SESSION_KEY = 'cknodejs.manager.session';
const KYIV = 'Europe/Kyiv';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const timeFormatter = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function todayInKyiv() {
  const parts = dateFormatter.formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;

  return `${value('year')}-${value('month')}-${value('day')}`;
}

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

// Кожна секція завантажується окремо. При зміні дати попередній
// запит скасовується, щоб його відповідь не потрапила в новий табель.
function useResource(path, token, onExpired, expectList = false) {
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

function useList(path, token, onExpired) {
  const { data, ...state } = useResource(path, token, onExpired, true);
  return { ...state, items: data };
}

function ListContent({ state, empty, children }) {
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

function GroupDay({ group, token, onExpired, onBack }) {
  const [date, setDate] = useState(todayInKyiv);
  const future = date > todayInKyiv();
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
                      {event.status === 'draft' && ' · Чернетка'}
                    </li>
                  ))}
                </ul>
              )}
            </ListContent>
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

function ParentHome({ parentId, token, onExpired }) {
  const children = useList(parentId ? `/parents/${parentId}/children` : null, token, onExpired);
  if (!parentId) return <p>До облікового запису ще не прив’язано профіль батьків.</p>;

  return (
    <section className="panel">
      <h1>Мої діти</h1>
      <ListContent state={children} empty="До вашого профілю ще не додано дітей.">
        {items => <ul>{items.map(child =>
          <li key={child.id}>{child.first_name} {child.last_name}</li>
        )}</ul>}
      </ListContent>
    </section>
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
            {lesson.status === 'draft' && ' · Чернетка'}
          </li>
        )}</ul>}
      </ListContent>
    </section>
  );
}

function Cabinet({ token, onExpired }) {
  const profile = useResource('/auth/me', token, onExpired);
  const [selected, setSelected] = useState(null);
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
    const title = user.role === 'admin' ? 'Кабінет адміністратора' : 'Кабінет менеджера';
    return selected
      ? <GroupDay group={selected} onBack={() => setSelected(null)} {...access} />
      : <Groups title={title} onSelect={setSelected} {...access} />;
  }
  if (user.role === 'parent') return <ParentHome parentId={user.parent_id} {...access} />;
  if (user.role === 'employee' && user.position === 'teacher') return <TeacherHome {...access} />;
  if (user.role === 'employee' && user.position === 'educator') {
    return user.group
      ? <GroupDay group={user.group} {...access} />
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