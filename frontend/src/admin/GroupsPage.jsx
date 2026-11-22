import { useState } from 'react';
import { api } from '../api.js';
import {
  ListContent,
  Notice,
  ageInYears,
  useList,
  useMutation,
  useResource
} from '../shared.jsx';

// Етап 7: групи та кімнати. Етап 8: персонал групи.
// Усі правила (вік, місткість, одна кімната — одна група,
// вихователь і помічник для активної групи) перевіряє база.

const roomStatuses = {
  available: 'Доступна',
  occupied: 'Зайнята',
  maintenance: 'Ремонт',
  inactive: 'Неактивна'
};

const staffRoles = {
  educator: 'Вихователь',
  assistant: 'Помічник'
};

// Унікальна кімната групи в базі дає 409 без коду KMS.
function explainGroupError(error) {
  if (error.status === 409 && !String(error.code).startsWith('KMS_')) {
    return 'Ця кімната вже закріплена за іншою групою. Одна основна кімната — одна група.';
  }
  return null;
}

function roomLabel(rooms, roomId) {
  const room = rooms?.find(item => String(item.id) === String(roomId));
  return room ? `${room.name} · до ${room.capacity} місць` : `Кімната №${roomId}`;
}

export function GroupsPage({ role, token, onExpired }) {
  const admin = role === 'admin';
  const [selectedId, setSelectedId] = useState(null);
  const groups = useList('/groups', token, onExpired);
  const rooms = useList(admin ? '/rooms' : null, token, onExpired);
  const action = useMutation(onExpired);

  if (selectedId) {
    return (
      <GroupCard
        key={selectedId}
        groupId={selectedId}
        role={role}
        rooms={rooms.items}
        token={token}
        onExpired={onExpired}
        onBack={() => {
          setSelectedId(null);
          groups.retry();
        }}
      />
    );
  }

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

    action.run(
      () => api('/groups', {
        token,
        method: 'POST',
        body: {
          name: fields.get('name').trim(),
          room_id: Number(fields.get('room_id')),
          age_years: Number(fields.get('age_years')),
          max_capacity: Number(fields.get('max_capacity'))
        }
      }),
      'Групу створено. Призначте вихователя й помічника та активуйте її.',
      group => {
        form.reset();
        groups.retry();
        setSelectedId(group.id);
      },
      explainGroupError
    );
  }

  return (
    <>
      <p className="eyebrow">Структура садочка</p>
      <h1>Групи й кімнати</h1>

      <ListContent state={groups} empty="Груп ще немає.">
        {items => (
          <div className="group-grid">
            {items.map(group => (
              <GroupTile
                key={group.id}
                group={group}
                rooms={rooms.items}
                token={token}
                onExpired={onExpired}
                onOpen={() => setSelectedId(group.id)}
              />
            ))}
          </div>
        )}
      </ListContent>

      <div className="panels">
        <section className="panel day-actions">
          <h2>Нова група</h2>
          <form onSubmit={create}>
            <GroupFields rooms={rooms.items} />
            <button className="primary" disabled={action.busy}>Створити групу</button>
          </form>
          <Notice notice={action.notice} />
        </section>

        {admin && (
          <Rooms
            rooms={rooms}
            groups={groups.items}
            token={token}
            onExpired={onExpired}
          />
        )}
      </div>
    </>
  );
}

// Плитка групи: склад і вільні місця з /groups/:id/capacity.
function GroupTile({ group, rooms, token, onExpired, onOpen }) {
  const capacity = useResource(`/groups/${group.id}/capacity`, token, onExpired);
  const data = capacity.data;

  return (
    <button className="group-card" onClick={onOpen}>
      <strong>{group.name}</strong>
      <span>Вік дітей: {group.age_years} р.</span>
      <span>
        {data
          ? `Дітей ${data.children_count} з ${data.capacity} · вільно ${data.free_places}`
          : 'Рахуємо місця…'}
      </span>
      {rooms && <span>{roomLabel(rooms, group.room_id)}</span>}
      <span className={group.status === 'active' ? 'badge ok' : 'badge'}>
        {group.status === 'active' ? 'Активна' : 'Неактивна'}
      </span>
    </button>
  );
}

function GroupFields({ group, rooms }) {
  return (
    <>
      <label>
        Назва
        <input name="name" defaultValue={group?.name} maxLength={50} required />
      </label>

      <label>
        Вік дітей
        <select name="age_years" defaultValue={group?.age_years ?? 3}>
          {[2, 3, 4, 5].map(age => (
            <option key={age} value={age}>{age} р.</option>
          ))}
        </select>
      </label>

      <label>
        Місткість (до 20 дітей)
        <input
          name="max_capacity"
          type="number"
          min="1"
          max="20"
          defaultValue={group?.max_capacity ?? 15}
          required
        />
      </label>

      <label>
        Основна кімната
        {rooms ? (
          <select name="room_id" defaultValue={group?.room_id ?? ''} key={rooms.length} required>
            <option value="">Оберіть кімнату</option>
            {rooms.map(room => (
              <option key={room.id} value={room.id}>
                {room.name} · до {room.capacity} місць · {roomStatuses[room.status] || room.status}
              </option>
            ))}
          </select>
        ) : (
          <input
            name="room_id"
            type="number"
            min="1"
            defaultValue={group?.room_id}
            placeholder="Номер кімнати"
            required
          />
        )}
      </label>
    </>
  );
}

function GroupCard({ groupId, role, rooms, token, onExpired, onBack }) {
  const group = useResource(`/groups/${groupId}`, token, onExpired);
  const capacity = useResource(`/groups/${groupId}/capacity`, token, onExpired);
  const children = useList(`/groups/${groupId}/children`, token, onExpired);
  const action = useMutation(onExpired);
  const data = group.data;

  if (group.error) {
    return (
      <div role="alert">
        <button className="back" onClick={onBack}>До всіх груп</button>
        <p className="alert">{group.error}</p>
        <button onClick={group.retry}>Спробувати ще раз</button>
      </div>
    );
  }

  if (!data) return <p role="status">Завантаження групи…</p>;

  const active = data.status === 'active';

  function reload() {
    group.retry();
    capacity.retry();
  }

  function save(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);

    action.run(
      () => api(`/groups/${groupId}`, {
        token,
        method: 'PATCH',
        body: {
          name: fields.get('name').trim(),
          room_id: Number(fields.get('room_id')),
          age_years: Number(fields.get('age_years')),
          max_capacity: Number(fields.get('max_capacity'))
        }
      }),
      'Зміни збережено.',
      reload,
      explainGroupError
    );
  }

  function toggleStatus() {
    action.run(
      () => api(`/groups/${groupId}/status`, {
        token,
        method: 'PATCH',
        body: { status: active ? 'inactive' : 'active' }
      }),
      active ? 'Групу деактивовано.' : 'Групу активовано.',
      reload
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>До всіх груп</button>

      <p className="eyebrow">Група №{data.id}</p>
      <h1>{data.name}</h1>
      <p className="muted">
        Вік {data.age_years} р.
        {capacity.data &&
          ` · дітей ${capacity.data.children_count} з ${capacity.data.capacity} · вільно ${capacity.data.free_places}`}
        {' · '}{active ? 'Активна' : 'Неактивна'}
      </p>

      <Notice notice={action.notice} />

      <div className="panels">
        <section className="panel day-actions">
          <h2>Дані групи</h2>
          <form onSubmit={save}>
            <GroupFields group={data} rooms={rooms} />
            <button disabled={action.busy}>Зберегти зміни</button>
          </form>

          <h2>Статус</h2>
          <p className="muted">
            {active
              ? 'Щоб змінити персонал, групу треба тимчасово деактивувати.'
              : 'Для активації потрібні вихователь і помічник.'}
          </p>
          <button disabled={action.busy} onClick={toggleStatus}>
            {active ? 'Деактивувати групу' : 'Активувати групу'}
          </button>
        </section>

        <div className="stack">
          <section className="panel">
            <h2>Склад групи</h2>
            <ListContent state={children} empty="У групі ще немає дітей.">
              {items => (
                <ul>
                  {items.map(child => (
                    <li key={child.id}>
                      <strong>{child.first_name} {child.last_name}</strong>
                      {child.date_of_birth && (
                        <span className="record-status">{ageInYears(child.date_of_birth)} р.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ListContent>
            <p className="muted">Зарахувати дитину можна в розділі «Діти», у її картці.</p>
          </section>

          <GroupStaff
            groupId={groupId}
            active={active}
            token={token}
            onExpired={onExpired}
          />
        </div>
      </div>
    </>
  );
}

// Етап 8: вихователь і помічник групи.
function GroupStaff({ groupId, active, token, onExpired }) {
  const staff = useList(`/groups/${groupId}/employees`, token, onExpired);
  const employees = useList('/employees', token, onExpired);
  const action = useMutation(onExpired);
  const [role, setRole] = useState('educator');

  const assigned = new Set((staff.items ?? []).map(item => String(item.id)));
  const candidates = (employees.items ?? []).filter(item =>
    item.position === role && item.status === 'active' && !assigned.has(String(item.id))
  );

  function assign(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);

    action.run(
      () => api(`/groups/${groupId}/employees`, {
        token,
        method: 'POST',
        body: { employee_id: Number(fields.get('employee_id')), role }
      }),
      `${staffRoles[role]} призначений до групи.`,
      staff.retry
    );
  }

  function remove(employee) {
    action.run(
      () => api(`/groups/${groupId}/employees/${employee.id}`, { token, method: 'DELETE' }),
      `${employee.first_name} ${employee.last_name} більше не в цій групі.`,
      staff.retry
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Персонал групи</h2>

      <ListContent state={staff} empty="До групи ще не призначено працівників.">
        {items => (
          <ul>
            {items.map(employee => (
              <li key={employee.id} className="row">
                <span>
                  <strong>{employee.first_name} {employee.last_name}</strong>
                  <span className="record-status">
                    {staffRoles[employee.group_role] || employee.group_role}
                  </span>
                </span>
                {!active && (
                  <button disabled={action.busy} onClick={() => remove(employee)}>
                    Зняти
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ListContent>

      {active ? (
        <p className="muted">Персонал змінюють у неактивній групі.</p>
      ) : (
        <form onSubmit={assign}>
          <label>
            Роль у групі
            <select value={role} onChange={event => setRole(event.target.value)}>
              <option value="educator">Вихователь</option>
              <option value="assistant">Помічник</option>
            </select>
          </label>
          <label>
            Працівник
            <select name="employee_id" required defaultValue="" key={role}>
              <option value="">
                {candidates.length ? 'Оберіть працівника' : 'Немає вільних працівників на цю посаду'}
              </option>
              {candidates.map(employee => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={action.busy || candidates.length === 0}>Призначити</button>
        </form>
      )}

      <Notice notice={action.notice} />
    </section>
  );
}

function Rooms({ rooms, groups, token, onExpired }) {
  const action = useMutation(onExpired);
  const [editing, setEditing] = useState(null);

  function usedBy(roomId) {
    return groups?.find(group => String(group.room_id) === String(roomId));
  }

  function body(form) {
    return {
      name: form.get('name').trim(),
      capacity: Number(form.get('capacity')),
      status: form.get('status')
    };
  }

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;

    action.run(
      () => api('/rooms', { token, method: 'POST', body: body(new FormData(form)) }),
      'Кімнату додано.',
      () => {
        form.reset();
        rooms.retry();
      }
    );
  }

  function save(event, room) {
    event.preventDefault();

    action.run(
      () => api(`/rooms/${room.id}`, {
        token,
        method: 'PATCH',
        body: body(new FormData(event.currentTarget))
      }),
      'Кімнату збережено.',
      () => {
        setEditing(null);
        rooms.retry();
      }
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Кімнати</h2>

      <ListContent state={rooms} empty="Кімнат ще немає.">
        {items => (
          <ul>
            {items.map(room => {
              const group = usedBy(room.id);

              return (
                <li key={room.id}>
                  {editing === room.id ? (
                    <form onSubmit={event => save(event, room)}>
                      <RoomFields room={room} />
                      <button disabled={action.busy}>Зберегти</button>{' '}
                      <button type="button" onClick={() => setEditing(null)}>Скасувати</button>
                    </form>
                  ) : (
                    <div className="row">
                      <span>
                        <strong>{room.name}</strong>
                        <small>
                          До {room.capacity} місць · {roomStatuses[room.status] || room.status}
                          {' · '}{group ? `група «${group.name}»` : 'вільна'}
                        </small>
                      </span>
                      <button onClick={() => setEditing(room.id)}>Змінити</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ListContent>

      <details>
        <summary>Додати кімнату</summary>
        <form onSubmit={create}>
          <RoomFields />
          <button disabled={action.busy}>Додати</button>
        </form>
      </details>

      <Notice notice={action.notice} />
    </section>
  );
}

function RoomFields({ room }) {
  return (
    <>
      <label>
        Назва
        <input name="name" defaultValue={room?.name} maxLength={50} required />
      </label>
      <label>
        Місткість
        <input
          name="capacity"
          type="number"
          min="1"
          max="500"
          defaultValue={room?.capacity ?? 20}
          required
        />
      </label>
      <label>
        Стан
        <select name="status" defaultValue={room?.status ?? 'available'}>
          {Object.entries(roomStatuses).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    </>
  );
}
