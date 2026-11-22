import { useState } from 'react';
import { api } from '../api.js';
import {
  ListContent,
  Notice,
  useList,
  useMutation
} from '../shared.jsx';

// Етап 8: картки працівників, предмети й призначення викладачам.
// Вихователя й помічника групі призначають у картці групи.

export const positions = {
  educator: 'Вихователь',
  assistant: 'Помічник',
  teacher: 'Викладач',
  manager: 'Менеджер',
  director: 'Директор',
  accountant: 'Бухгалтер',
  nurse: 'Медсестра',
  cook: 'Кухар'
};

const statuses = {
  active: 'Працює',
  on_leave: 'У відпустці',
  inactive: 'Неактивний'
};

function employeeBody(form) {
  return {
    first_name: form.get('first_name').trim(),
    last_name: form.get('last_name').trim(),
    email: form.get('email').trim(),
    phone: form.get('phone').trim(),
    position: form.get('position'),
    salary: Number(form.get('salary'))
  };
}

export function StaffPage({ role, token, onExpired }) {
  const admin = role === 'admin';
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const employees = useList('/employees', token, onExpired);
  const action = useMutation(onExpired);

  if (selected) {
    return (
      <EmployeeCard
        key={selected.id}
        employee={selected}
        admin={admin}
        token={token}
        onExpired={onExpired}
        onBack={() => {
          setSelected(null);
          employees.retry();
        }}
      />
    );
  }

  const visible = {
    ...employees,
    items: employees.items?.filter(item => !filter || item.position === filter)
  };

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;

    action.run(
      () => api('/employees', {
        token,
        method: 'POST',
        body: employeeBody(new FormData(form))
      }),
      'Картку працівника створено.',
      employee => {
        form.reset();
        employees.retry();
        setSelected(employee);
      }
    );
  }

  return (
    <>
      <p className="eyebrow">Структура садочка</p>
      <h1>Персонал</h1>

      <div className="panels">
        <section className="panel">
          <label>
            Посада
            <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="">Усі посади</option>
              {Object.entries(positions).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <ListContent state={visible} empty="Працівників на цій посаді немає.">
            {items => (
              <ul>
                {items.map(employee => (
                  <li key={employee.id}>
                    <button className="link" onClick={() => setSelected(employee)}>
                      {employee.first_name} {employee.last_name}
                    </button>
                    <small>
                      {positions[employee.position] || employee.position}
                      {' · '}{statuses[employee.status] || employee.status}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>

        <div className="stack">
          {admin && (
            <section className="panel day-actions">
              <h2>Новий працівник</h2>
              <form onSubmit={create}>
                <EmployeeFields />
                <button className="primary" disabled={action.busy}>Створити картку</button>
              </form>
              <Notice notice={action.notice} />
            </section>
          )}

          {admin && <Subjects token={token} onExpired={onExpired} />}
        </div>
      </div>
    </>
  );
}

function EmployeeFields({ employee }) {
  return (
    <>
      <label>
        Ім’я
        <input name="first_name" defaultValue={employee?.first_name} maxLength={50} required />
      </label>
      <label>
        Прізвище
        <input name="last_name" defaultValue={employee?.last_name} maxLength={50} required />
      </label>
      <label>
        Електронна пошта
        <input name="email" type="email" defaultValue={employee?.email} maxLength={100} required />
      </label>
      <label>
        Телефон
        <input name="phone" type="tel" defaultValue={employee?.phone} minLength={7} maxLength={20} required />
      </label>
      <label>
        Посада
        <select name="position" defaultValue={employee?.position ?? 'educator'}>
          {Object.entries(positions).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        Ставка, грн на місяць
        <input
          name="salary"
          type="number"
          min="0"
          step="0.01"
          defaultValue={employee?.salary ?? ''}
          required
        />
      </label>
    </>
  );
}

function EmployeeCard({ employee, admin, token, onExpired, onBack }) {
  const [current, setCurrent] = useState(employee);
  const groups = useList(`/employees/${employee.id}/groups`, token, onExpired);
  const action = useMutation(onExpired);

  function save(event) {
    event.preventDefault();

    action.run(
      () => api(`/employees/${employee.id}`, {
        token,
        method: 'PATCH',
        body: employeeBody(new FormData(event.currentTarget))
      }),
      'Зміни збережено.',
      setCurrent
    );
  }

  function setStatus(event) {
    action.run(
      () => api(`/employees/${employee.id}/status`, {
        token,
        method: 'PATCH',
        body: { status: event.target.value }
      }),
      'Статус змінено.',
      setCurrent
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>До списку персоналу</button>
      <p className="eyebrow">Картка працівника №{current.id}</p>
      <h1>{current.first_name} {current.last_name}</h1>
      <p className="muted">
        {positions[current.position] || current.position} · {statuses[current.status] || current.status}
      </p>

      <Notice notice={action.notice} />

      <div className="panels">
        <section className="panel day-actions">
          <h2>Дані працівника</h2>
          {admin ? (
            <>
              <form onSubmit={save}>
                <EmployeeFields employee={current} />
                <button disabled={action.busy}>Зберегти зміни</button>
              </form>

              <label>
                Статус
                <select value={current.status} onChange={setStatus} disabled={action.busy}>
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p>{current.email} · {current.phone}</p>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <h2>Групи</h2>
            <ListContent state={groups} empty="Працівник не призначений до груп.">
              {items => (
                <ul>
                  {items.map(group => (
                    <li key={group.id}>
                      <strong>{group.name}</strong>
                      <span className="record-status">
                        {group.staff_role === 'educator' ? 'Вихователь' : 'Помічник'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ListContent>
            <p className="muted">Призначення до групи — у розділі «Групи й кімнати».</p>
          </section>

          {admin && current.position === 'teacher' && (
            <TeacherSubjects employeeId={current.id} token={token} onExpired={onExpired} />
          )}
        </div>
      </div>
    </>
  );
}

function TeacherSubjects({ employeeId, token, onExpired }) {
  const subjects = useList('/subjects', token, onExpired);
  const mine = useList(`/employees/${employeeId}/subjects`, token, onExpired);
  const action = useMutation(onExpired);

  const chosen = new Set((mine.items ?? []).map(item => String(item.id)));

  function save(event) {
    event.preventDefault();
    const ids = new FormData(event.currentTarget).getAll('subject_id').map(Number);

    action.run(
      () => api(`/employees/${employeeId}/subjects`, {
        token,
        method: 'PUT',
        body: { subject_ids: ids }
      }),
      'Предмети викладача збережено.',
      mine.retry
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Предмети викладача</h2>
      <ListContent state={subjects} empty="Спершу додайте предмети на сторінці «Персонал».">
        {items => mine.items ? (
          <form onSubmit={save} key={[...chosen].join(',')}>
            <fieldset className="checks">
              {items.map(subject => (
                <label key={subject.id} className="check">
                  <input
                    type="checkbox"
                    name="subject_id"
                    value={subject.id}
                    defaultChecked={chosen.has(String(subject.id))}
                  />
                  {subject.name}
                </label>
              ))}
            </fieldset>
            <button disabled={action.busy}>Зберегти предмети</button>
          </form>
        ) : <p role="status">Завантаження…</p>}
      </ListContent>
      <Notice notice={action.notice} />
    </section>
  );
}

function Subjects({ token, onExpired }) {
  const subjects = useList('/subjects', token, onExpired);
  const action = useMutation(onExpired);

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const description = fields.get('description').trim();

    action.run(
      () => api('/subjects', {
        token,
        method: 'POST',
        body: {
          name: fields.get('name').trim(),
          description: description || null
        }
      }),
      'Предмет додано. Призначте його викладачу в картці працівника.',
      () => {
        form.reset();
        subjects.retry();
      }
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Предмети</h2>

      <ListContent state={subjects} empty="Предметів ще немає.">
        {items => (
          <ul>
            {items.map(subject => (
              <SubjectRow key={subject.id} subject={subject} token={token} onExpired={onExpired} />
            ))}
          </ul>
        )}
      </ListContent>

      <details>
        <summary>Додати предмет</summary>
        <form onSubmit={create}>
          <label>
            Назва
            <input name="name" minLength={2} maxLength={100} required />
          </label>
          <label>
            Опис
            <input name="description" maxLength={1000} />
          </label>
          <button disabled={action.busy}>Додати</button>
        </form>
      </details>

      <Notice notice={action.notice} />
    </section>
  );
}

function SubjectRow({ subject, token, onExpired }) {
  const teachers = useList(`/subjects/${subject.id}/teachers`, token, onExpired);
  const names = teachers.items?.map(item => `${item.first_name} ${item.last_name}`).join(', ');

  return (
    <li>
      <strong>{subject.name}</strong>
      <small>
        {teachers.items ? (names || 'Викладача не призначено') : 'Завантаження…'}
      </small>
    </li>
  );
}
