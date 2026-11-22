import { useState } from 'react';
import { api } from '../api.js';
import {
  ListContent,
  Notice,
  ageInYears,
  calendarDate,
  optionalText,
  todayInKyiv,
  useList,
  useMutation,
  useResource
} from '../shared.jsx';

// Етап 6: картка дитини, батьки й зарахування до групи.
// Перевірки віку, місткості та архіву робить база — сторінка
// лише показує її пояснення.

const filters = [
  ['active', 'Активні', '/children'],
  ['archived', 'Архів', '/children?status=archived'],
  ['all', 'Усі', '/children?status=all']
];

export const relationshipLabels = {
  mother: 'Мама',
  father: 'Тато',
  guardian: 'Опікун',
  parent: 'Батьки'
};

function childName(child) {
  return `${child.first_name} ${child.last_name}`;
}

function groupName(groups, groupId) {
  if (!groupId) return 'Без групи';
  const group = groups?.find(item => String(item.id) === String(groupId));
  return group ? group.name : `Група №${groupId}`;
}

// Дані форми картки дитини у форматі API.
function childBody(form) {
  return {
    first_name: form.get('first_name').trim(),
    last_name: form.get('last_name').trim(),
    date_of_birth: form.get('date_of_birth'),
    dietary_preferences: optionalText(form.get('dietary_preferences')),
    notes: optionalText(form.get('notes'))
  };
}

function ChildFields({ child }) {
  return (
    <>
      <label>
        Ім’я
        <input name="first_name" defaultValue={child?.first_name} maxLength={50} required />
      </label>

      <label>
        Прізвище
        <input name="last_name" defaultValue={child?.last_name} maxLength={50} required />
      </label>

      <label>
        Дата народження
        <input
          name="date_of_birth"
          type="date"
          max={todayInKyiv()}
          defaultValue={child?.date_of_birth?.slice(0, 10)}
          required
        />
      </label>

      <label>
        Особливості харчування
        <input name="dietary_preferences" defaultValue={child?.dietary_preferences ?? ''} />
      </label>

      <label>
        Примітки
        <input name="notes" defaultValue={child?.notes ?? ''} />
      </label>
    </>
  );
}

export function ChildrenPage({ role, token, onExpired }) {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const path = filters.find(([id]) => id === filter)[2];
  const children = useList(path, token, onExpired);
  const groups = useList('/groups', token, onExpired);
  const action = useMutation(onExpired);

  if (selectedId) {
    return (
      <ChildCard
        key={selectedId}
        childId={selectedId}
        role={role}
        groups={groups.items}
        token={token}
        onExpired={onExpired}
        onBack={() => {
          setSelectedId(null);
          children.retry();
        }}
      />
    );
  }

  const needle = search.trim().toLowerCase();
  const visible = {
    ...children,
    items: children.items?.filter(child =>
      childName(child).toLowerCase().includes(needle)
    )
  };

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const groupId = fields.get('group_id');

    action.run(
      () => api('/children', {
        token,
        method: 'POST',
        body: {
          ...childBody(fields),
          group_id: groupId ? Number(groupId) : null
        }
      }),
      'Картку дитини створено.',
      child => {
        form.reset();
        children.retry();
        setSelectedId(child.id);
      }
    );
  }

  return (
    <>
      <p className="eyebrow">Етап зарахування</p>
      <h1>Діти</h1>

      <div className="panels">
        <section className="panel">
          <div className="toolbar">
            <div className="cabinet-nav" role="group" aria-label="Статус картки">
              {filters.map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <label>
              Пошук за ім’ям
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </label>
          </div>

          <ListContent state={visible} empty="Дітей за цим фільтром немає.">
            {items => (
              <ul>
                {items.map(child => (
                  <li key={child.id}>
                    <button className="link" onClick={() => setSelectedId(child.id)}>
                      {childName(child)}
                    </button>
                    <small>
                      {ageInYears(child.date_of_birth)} р.
                      {' · '}{groupName(groups.items, child.group_id)}
                      {child.status === 'archived' && ' · В архіві'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>

        <section className="panel day-actions">
          <h2>Додати дитину</h2>

          <form onSubmit={create}>
            <ChildFields />

            <label>
              Група
              <select name="group_id" defaultValue="">
                <option value="">Поки без групи</option>
                {groups.items?.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.age_years} р.
                  </option>
                ))}
              </select>
            </label>

            <button className="primary" disabled={action.busy}>
              Створити картку
            </button>
          </form>

          <Notice notice={action.notice} />
        </section>
      </div>
    </>
  );
}

function ChildCard({ childId, role, groups, token, onExpired, onBack }) {
  const child = useResource(`/children/${childId}`, token, onExpired);
  const action = useMutation(onExpired);
  const data = child.data;

  if (child.error) {
    return (
      <div role="alert">
        <button className="back" onClick={onBack}>До списку дітей</button>
        <p className="alert">{child.error}</p>
        <button onClick={child.retry}>Спробувати ще раз</button>
      </div>
    );
  }

  if (!data) return <p role="status">Завантаження картки…</p>;

  const archived = data.status === 'archived';

  function save(event) {
    event.preventDefault();
    action.run(
      () => api(`/children/${childId}`, {
        token,
        method: 'PATCH',
        body: childBody(new FormData(event.currentTarget))
      }),
      'Зміни збережено.',
      child.retry
    );
  }

  function archive(event) {
    event.preventDefault();
    const reason = optionalText(new FormData(event.currentTarget).get('reason'));

    action.run(
      () => api(`/children/${childId}/archive`, {
        token,
        method: 'POST',
        body: reason ? { reason } : {}
      }),
      'Картку перенесено в архів. Дитину прибрано з групи.',
      child.retry
    );
  }

  function unarchive() {
    action.run(
      () => api(`/children/${childId}/unarchive`, { token, method: 'POST' }),
      'Картку повернуто з архіву.',
      child.retry
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>До списку дітей</button>

      <div className="day-heading">
        <div>
          <p className="eyebrow">Картка дитини №{data.id}</p>
          <h1>{childName(data)}</h1>
          <p className="muted">
            {calendarDate(data.date_of_birth)} · {ageInYears(data.date_of_birth)} р.
            {' · '}{archived ? 'В архіві' : 'Активна'}
          </p>
        </div>
      </div>

      <Notice notice={action.notice} />

      <div className="panels">
        <section className="panel day-actions">
          <h2>Дані дитини</h2>

          {archived ? (
            <p className="muted">Архівну картку не редагують. Поверніть її з архіву.</p>
          ) : (
            <form onSubmit={save}>
              <ChildFields child={data} />
              <button disabled={action.busy}>Зберегти зміни</button>
            </form>
          )}
        </section>

        <div className="stack">
          <Enrollment
            child={data}
            groups={groups}
            token={token}
            onExpired={onExpired}
            onSaved={child.retry}
          />

          <ChildParents
            child={data}
            token={token}
            onExpired={onExpired}
          />

          <section className="panel day-actions">
            <h2>Архів</h2>

            {archived ? (
              role === 'admin' ? (
                <button disabled={action.busy} onClick={unarchive}>
                  Повернути з архіву
                </button>
              ) : (
                <p className="muted">Повернути картку з архіву може адміністратор.</p>
              )
            ) : (
              <details>
                <summary>Архівувати картку</summary>
                <form onSubmit={archive}>
                  <label>
                    Причина
                    <input name="reason" maxLength={500} />
                  </label>
                  <button disabled={action.busy}>Перенести в архів</button>
                </form>
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Enrollment({ child, groups, token, onExpired, onSaved }) {
  const [groupId, setGroupId] = useState('');
  const action = useMutation(onExpired);
  const capacity = useResource(
    groupId ? `/groups/${groupId}/capacity` : null,
    token,
    onExpired
  );

  const archived = child.status === 'archived';
  const age = ageInYears(child.date_of_birth);
  const current = groups?.find(group => String(group.id) === String(child.group_id));
  const choices = groups?.filter(group => String(group.id) !== String(child.group_id)) ?? [];
  const chosen = groups?.find(group => String(group.id) === groupId);

  function setGroup(nextGroupId, success) {
    action.run(
      () => api(`/children/${child.id}`, {
        token,
        method: 'PATCH',
        body: { group_id: nextGroupId }
      }),
      success,
      () => {
        setGroupId('');
        onSaved();
      }
    );
  }

  function enroll(event) {
    event.preventDefault();
    setGroup(
      Number(groupId),
      `${child.first_name} тепер у групі «${chosen?.name}».`
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Група</h2>

      <p>
        <strong>{current ? current.name : 'Без групи'}</strong>
        {current && <small>Вік групи: {current.age_years} р.</small>}
      </p>

      {archived ? (
        <p className="muted">Архівну дитину не зараховують до групи.</p>
      ) : (
        <>
          <form onSubmit={enroll}>
            <label>
              {current ? 'Перевести до групи' : 'Зарахувати до групи'}
              <select
                value={groupId}
                onChange={event => setGroupId(event.target.value)}
                required
              >
                <option value="">Оберіть групу</option>
                {choices.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.age_years} р.
                  </option>
                ))}
              </select>
            </label>

            {chosen && (
              <p className="muted" role="status">
                {capacity.data
                  ? `Вільних місць: ${capacity.data.free_places} з ${capacity.data.capacity}.`
                  : capacity.error || 'Перевіряємо вільні місця…'}
                {Number(chosen.age_years) !== age &&
                  ` Увага: дитині ${age} р., а група для ${chosen.age_years} р.`}
              </p>
            )}

            <button disabled={action.busy || !groupId}>
              {current ? 'Перевести' : 'Зарахувати'}
            </button>
          </form>

          {current && (
            <button
              disabled={action.busy}
              onClick={() => setGroup(null, 'Дитину прибрано з групи.')}
            >
              Прибрати з групи
            </button>
          )}
        </>
      )}

      <Notice notice={action.notice} />
    </section>
  );
}

function ChildParents({ child, token, onExpired }) {
  const linked = useList(`/children/${child.id}/parents`, token, onExpired);
  const all = useList('/parents', token, onExpired);
  const action = useMutation(onExpired);

  // /children/:id/parents повертає ідентифікатор як parent_id.
  const linkedIds = new Set((linked.items ?? []).map(parent => String(parent.parent_id ?? parent.id)));
  const available = (all.items ?? []).filter(parent => !linkedIds.has(String(parent.id)));

  function link(parentId, relationship) {
    return api(`/parents/${parentId}/children`, {
      token,
      method: 'POST',
      body: { child_id: Number(child.id), relationship_type: relationship }
    });
  }

  function linkExisting(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

    action.run(
      () => link(fields.get('parent_id'), fields.get('relationship_type')),
      'Батьків прив’язано. Тепер вони бачать дитину у своєму кабінеті.',
      () => {
        form.reset();
        linked.retry();
      }
    );
  }

  function createAndLink(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

    action.run(
      async () => {
        const parent = await api('/parents', {
          token,
          method: 'POST',
          body: {
            first_name: fields.get('first_name').trim(),
            last_name: fields.get('last_name').trim(),
            email: fields.get('email').trim(),
            phone: fields.get('phone').trim()
          }
        });
        return link(parent.id, fields.get('relationship_type'));
      },
      'Профіль батьків створено й прив’язано. Обліковий запис для входу створює адміністратор.',
      () => {
        form.reset();
        linked.retry();
        all.retry();
      }
    );
  }

  return (
    <section className="panel day-actions">
      <h2>Батьки</h2>

      <ListContent state={linked} empty="До дитини ще не прив’язано батьків.">
        {items => (
          <ul>
            {items.map(parent => (
              <li key={parent.parent_id ?? parent.id}>
                <strong>{parent.first_name} {parent.last_name}</strong>
                <span className="record-status">
                  {relationshipLabels[parent.relationship_type] || parent.relationship_type}
                </span>
                <small>{parent.phone} · {parent.email}</small>
              </li>
            ))}
          </ul>
        )}
      </ListContent>

      <details>
        <summary>Прив’язати наявного</summary>
        <form onSubmit={linkExisting}>
          <label>
            Батьки
            <select name="parent_id" required defaultValue="">
              <option value="">Оберіть зі списку</option>
              {available.map(parent => (
                <option key={parent.id} value={parent.id}>
                  {parent.first_name} {parent.last_name} · {parent.phone}
                </option>
              ))}
            </select>
          </label>
          <RelationshipSelect />
          <button disabled={action.busy}>Прив’язати</button>
        </form>
      </details>

      <details>
        <summary>Додати нових батьків</summary>
        <form onSubmit={createAndLink}>
          <ParentFields />
          <RelationshipSelect />
          <button disabled={action.busy}>Створити й прив’язати</button>
        </form>
      </details>

      <Notice notice={action.notice} />
    </section>
  );
}

export function RelationshipSelect() {
  return (
    <label>
      Хто для дитини
      <select name="relationship_type" defaultValue="mother">
        {Object.entries(relationshipLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}

export function ParentFields({ parent }) {
  return (
    <>
      <label>
        Ім’я
        <input name="first_name" defaultValue={parent?.first_name} maxLength={50} required />
      </label>
      <label>
        Прізвище
        <input name="last_name" defaultValue={parent?.last_name} maxLength={50} required />
      </label>
      <label>
        Електронна пошта
        <input name="email" type="email" defaultValue={parent?.email} maxLength={100} required />
      </label>
      <label>
        Телефон
        <input
          name="phone"
          type="tel"
          defaultValue={parent?.phone}
          minLength={7}
          maxLength={20}
          required
        />
      </label>
    </>
  );
}
