import { useState } from 'react';
import { api } from '../api.js';
import {
  ListContent,
  Notice,
  ageInYears,
  useList,
  useMutation
} from '../shared.jsx';
import { ParentFields } from './ChildrenPage.jsx';

// Етап 6: профілі батьків — список, створення, контакти й діти.

function parentBody(form) {
  return {
    first_name: form.get('first_name').trim(),
    last_name: form.get('last_name').trim(),
    email: form.get('email').trim(),
    phone: form.get('phone').trim()
  };
}

export function ParentsPage({ token, onExpired }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const parents = useList('/parents', token, onExpired);
  const action = useMutation(onExpired);

  if (selected) {
    return (
      <ParentCard
        key={selected.id}
        parent={selected}
        token={token}
        onExpired={onExpired}
        onBack={() => {
          setSelected(null);
          parents.retry();
        }}
      />
    );
  }

  const needle = search.trim().toLowerCase();
  const visible = {
    ...parents,
    items: parents.items?.filter(parent =>
      [parent.first_name, parent.last_name, parent.phone, parent.email]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  };

  function create(event) {
    event.preventDefault();
    const form = event.currentTarget;

    action.run(
      () => api('/parents', {
        token,
        method: 'POST',
        body: parentBody(new FormData(form))
      }),
      'Профіль батьків створено. Прив’яжіть дитину в її картці.',
      () => {
        form.reset();
        parents.retry();
      }
    );
  }

  return (
    <>
      <p className="eyebrow">Етап зарахування</p>
      <h1>Батьки</h1>

      <div className="panels">
        <section className="panel">
          <label>
            Пошук за ім’ям, телефоном або поштою
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </label>

          <ListContent state={visible} empty="Батьків за цим пошуком немає.">
            {items => (
              <ul>
                {items.map(parent => (
                  <li key={parent.id}>
                    <button className="link" onClick={() => setSelected(parent)}>
                      {parent.first_name} {parent.last_name}
                    </button>
                    <small>{parent.phone} · {parent.email}</small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>

        <section className="panel day-actions">
          <h2>Додати батьків</h2>
          <form onSubmit={create}>
            <ParentFields />
            <button className="primary" disabled={action.busy}>
              Створити профіль
            </button>
          </form>
          <Notice notice={action.notice} />
        </section>
      </div>
    </>
  );
}

function ParentCard({ parent, token, onExpired, onBack }) {
  const [current, setCurrent] = useState(parent);
  const children = useList(`/parents/${parent.id}/children`, token, onExpired);
  const action = useMutation(onExpired);

  function save(event) {
    event.preventDefault();

    action.run(
      () => api(`/parents/${parent.id}`, {
        token,
        method: 'PATCH',
        body: parentBody(new FormData(event.currentTarget))
      }),
      'Контакти збережено.',
      setCurrent
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>До списку батьків</button>
      <p className="eyebrow">Профіль батьків №{current.id}</p>
      <h1>{current.first_name} {current.last_name}</h1>

      <div className="panels">
        <section className="panel day-actions">
          <h2>Контакти</h2>
          <form onSubmit={save}>
            <ParentFields parent={current} />
            <button disabled={action.busy}>Зберегти зміни</button>
          </form>
          <Notice notice={action.notice} />
        </section>

        <section className="panel">
          <h2>Діти</h2>
          <p className="muted">Прив’язати дитину можна в розділі «Діти», у її картці.</p>

          <ListContent state={children} empty="До цього профілю ще не прив’язано дітей.">
            {items => (
              <ul>
                {items.map(child => (
                  <li key={child.id}>
                    <strong>{child.first_name} {child.last_name}</strong>
                    <small>
                      {ageInYears(child.date_of_birth)} р.
                      {child.status === 'archived' && ' · В архіві'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </ListContent>
        </section>
      </div>
    </>
  );
}
