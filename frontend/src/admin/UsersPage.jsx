import { useState } from 'react';
import { api } from '../api.js';
import {
  ListContent,
  Notice,
  useList,
  useMutation
} from '../shared.jsx';
import { positions } from './StaffPage.jsx';

// Етап 9: облікові записи для входу, ролі й доступ.
// Тільки для адміністратора — так само обмежено й у бекенді.

const roles = {
  manager: 'Менеджер',
  employee: 'Працівник',
  parent: 'Батьки',
  admin: 'Адміністратор'
};

const statuses = {
  active: 'Активний',
  inactive: 'Вимкнений',
  blocked: 'Заблокований',
  pending: 'Очікує'
};

// Що побачить людина після входу.
const roleHints = {
  manager: 'Групи, діти, батьки, розклад і рахунки; без користувачів і кімнат.',
  employee: 'Вихователь — свою групу й табель; викладач — свій розклад; помічник — без доступу до даних.',
  parent: 'Тільки своїх дітей: відвідуваність, розклад, рахунки.',
  admin: 'Усе, включно з користувачами й кімнатами.'
};

function person(item) {
  return `${item.first_name} ${item.last_name}`;
}

function linkLabel(user, parents, employees) {
  if (user.parent_id) {
    const parent = parents?.find(item => String(item.id) === String(user.parent_id));
    return parent ? `Батьки: ${person(parent)}` : `Батьки №${user.parent_id}`;
  }
  if (user.employee_id) {
    const employee = employees?.find(item => String(item.id) === String(user.employee_id));
    return employee
      ? `${positions[employee.position] || employee.position}: ${person(employee)}`
      : `Працівник №${user.employee_id}`;
  }
  return null;
}

// Поля ролі та прив’язки: батькам — профіль батьків, працівнику — картка.
function RoleFields({ role, setRole, parents, employees, user }) {
  return (
    <>
      <label>
        Роль
        <select name="role" value={role} onChange={event => setRole(event.target.value)}>
          {Object.entries(roles).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <p className="muted">{roleHints[role]}</p>

      {role === 'parent' && (
        <label>
          Профіль батьків
          <select name="parent_id" required defaultValue={user?.parent_id ?? ''}>
            <option value="">Оберіть батьків</option>
            {parents?.map(item => (
              <option key={item.id} value={item.id}>{person(item)} · {item.email}</option>
            ))}
          </select>
        </label>
      )}

      {role === 'employee' && (
        <label>
          Картка працівника
          <select name="employee_id" required defaultValue={user?.employee_id ?? ''}>
            <option value="">Оберіть працівника</option>
            {employees?.map(item => (
              <option key={item.id} value={item.id}>
                {person(item)} · {positions[item.position] || item.position}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function roleBody(fields) {
  const role = fields.get('role');
  return {
    role,
    parent_id: role === 'parent' ? Number(fields.get('parent_id')) : null,
    employee_id: role === 'employee' ? Number(fields.get('employee_id')) : null
  };
}

function explainUserError(error) {
  if (error.status === 409 && !String(error.code).startsWith('KMS_')) {
    return 'Такий логін, пошта або прив’язка вже є в іншого облікового запису.';
  }
  return null;
}

export function UsersPage({ token, onExpired }) {
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('parent');

  const users = useList(
    showInactive ? '/users?include_inactive=true' : '/users',
    token,
    onExpired
  );
  const parents = useList('/parents', token, onExpired);
  const employees = useList('/employees', token, onExpired);
  const action = useMutation(onExpired);

  if (selected) {
    return (
      <UserCard
        key={selected.id}
        user={selected}
        parents={parents.items}
        employees={employees.items}
        token={token}
        onExpired={onExpired}
        onBack={() => {
          setSelected(null);
          users.retry();
        }}
      />
    );
  }

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const username = fields.get('username').trim();

    action.run(
      () => api('/users', {
        token,
        method: 'POST',
        body: {
          name: fields.get('name').trim(),
          email: fields.get('email').trim(),
          ...(username ? { username } : {}),
          password: fields.get('password'),
          ...roleBody(fields)
        }
      }),
      'Обліковий запис створено. Передайте логін і пароль власнику.',
      () => {
        form.reset();
        setRole('parent');
        users.retry();
      },
      explainUserError
    );
  }

  return (
    <>
      <p className="eyebrow">Доступ до системи</p>
      <h1>Користувачі</h1>

      <div className="panels">
        <section className="panel">
          <label className="check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={event => setShowInactive(event.target.checked)}
            />
            Показати вимкнені
          </label>

          <ListContent state={users} empty="Користувачів немає.">
            {items => (
              <ul>
                {items.map(user => (
                  <li key={user.id}>
                    <button className="link" onClick={() => setSelected(user)}>
                      {user.name}
                    </button>
                    <span className="record-status">{roles[user.role] || user.role}</span>
                    <small>
                      {user.username || user.email}
                      {' · '}{statuses[user.status] || user.status}
                      {linkLabel(user, parents.items, employees.items) &&
                        ` · ${linkLabel(user, parents.items, employees.items)}`}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>

        <section className="panel day-actions">
          <h2>Новий обліковий запис</h2>
          <form onSubmit={create}>
            <label>
              Ім’я для показу
              <input name="name" minLength={2} maxLength={100} required />
            </label>
            <label>
              Електронна пошта
              <input name="email" type="email" maxLength={100} required />
            </label>
            <label>
              Логін (необов’язково)
              <input name="username" maxLength={50} autoComplete="off" autoCapitalize="none" />
            </label>
            <label>
              Початковий пароль (від 8 символів)
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
            </label>

            <RoleFields
              role={role}
              setRole={setRole}
              parents={parents.items}
              employees={employees.items}
            />

            <button className="primary" disabled={action.busy}>Створити</button>
          </form>
          <Notice notice={action.notice} />
        </section>
      </div>
    </>
  );
}

function UserCard({ user, parents, employees, token, onExpired, onBack }) {
  const [current, setCurrent] = useState(user);
  const [role, setRole] = useState(user.role);
  const action = useMutation(onExpired);
  const active = current.status === 'active';

  function changeRole(event) {
    event.preventDefault();

    action.run(
      () => api(`/users/${current.id}/role`, {
        token,
        method: 'PATCH',
        body: roleBody(new FormData(event.currentTarget))
      }),
      'Роль змінено. Нові права діють з наступного входу.',
      setCurrent,
      explainUserError
    );
  }

  function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;

    action.run(
      () => api(`/users/${current.id}`, {
        token,
        method: 'PATCH',
        body: { password: new FormData(form).get('password') }
      }),
      'Пароль змінено. Усі відкриті сесії цього користувача завершено.',
      updated => {
        form.reset();
        setCurrent(updated);
      }
    );
  }

  function deactivate() {
    action.run(
      () => api(`/users/${current.id}`, { token, method: 'DELETE' }),
      'Доступ вимкнено. Користувач більше не зможе увійти.',
      () => setCurrent({ ...current, status: 'inactive', is_active: false })
    );
  }

  function activate() {
    action.run(
      () => api(`/users/${current.id}/status`, {
        token,
        method: 'PATCH',
        body: { status: 'active' }
      }),
      'Доступ відновлено.',
      setCurrent
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>До списку користувачів</button>
      <p className="eyebrow">Обліковий запис №{current.id}</p>
      <h1>{current.name}</h1>
      <p className="muted">
        {current.username || current.email} · {roles[current.role] || current.role}
        {' · '}{statuses[current.status] || current.status}
        {linkLabel(current, parents, employees) && ` · ${linkLabel(current, parents, employees)}`}
      </p>

      <Notice notice={action.notice} />

      {current.role === 'admin' ? (
        <section className="panel">
          <p>Обліковий запис адміністратора захищений: його роль і доступ не змінюють.</p>
        </section>
      ) : (
        <div className="panels">
          <section className="panel day-actions">
            <h2>Роль і прив’язка</h2>
            <form onSubmit={changeRole}>
              <RoleFields
                role={role}
                setRole={setRole}
                parents={parents}
                employees={employees}
                user={current}
              />
              <button disabled={action.busy}>Змінити роль</button>
            </form>
          </section>

          <div className="stack">
            <section className="panel day-actions">
              <h2>Пароль</h2>
              <form onSubmit={changePassword}>
                <label>
                  Новий пароль
                  <input name="password" type="password" minLength={8} autoComplete="new-password" required />
                </label>
                <button disabled={action.busy}>Змінити пароль</button>
              </form>
            </section>

            <section className="panel day-actions">
              <h2>Доступ</h2>
              {active ? (
                <button disabled={action.busy} onClick={deactivate}>Вимкнути доступ</button>
              ) : (
                <button disabled={action.busy} onClick={activate}>Відновити доступ</button>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
