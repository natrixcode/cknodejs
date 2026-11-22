import { useState } from 'react';
import { api } from '../api.js';
import { kyivStart } from '../DayActions.jsx';
import { Notice, useList, useMutation } from '../shared.jsx';

// Етап 10: ручне керування заняттями в чернетці дня.
// Конфлікти кімнати, викладача, групи й режимних блоків
// перевіряє база; тут показуємо її пояснення.

const clock = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const durations = [30, 45, 60];

function name(items, id, format) {
  const item = items?.find(entry => String(entry.id) === String(id));
  return item ? format(item) : `№${id}`;
}

function minutesBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60000);
}

function interval(date, time, minutes) {
  const start = kyivStart(date, time);
  const end = new Date(start.getTime() + minutes * 60000);
  return { start_time: start.toISOString(), end_time: end.toISOString() };
}

export function LessonEditor({ role, group, date, state, token, onExpired }) {
  const admin = role === 'admin';
  const subjects = useList(admin ? '/subjects' : null, token, onExpired);
  const rooms = useList(admin ? '/rooms' : null, token, onExpired);
  const employees = useList(admin ? '/employees' : null, token, onExpired);
  const action = useMutation(onExpired);
  const [moving, setMoving] = useState(null);

  if (!admin) return null;

  const lessons = (state.items ?? []).filter(event => event.type === 'lesson');
  const teachers = (employees.items ?? []).filter(item =>
    item.position === 'teacher' && item.status === 'active'
  );
  const locked = action.busy || !state.items;

  const subjectName = id => id ? name(subjects.items, id, item => item.name) : 'Без предмета';
  const teacherName = id => name(employees.items, id, item => `${item.first_name} ${item.last_name}`);
  const roomName = id => name(rooms.items, id, item => item.name);

  // Чернетку база приймає без перевірки конфліктів, тому спершу питаємо
  // SQL (kms_validate_lesson_draft): зайнята кімната, викладач, група,
  // режимні блоки, межі робочого дня, предмет викладача.
  function validate(lesson, excludeId) {
    return api('/schedule/validate', {
      token,
      method: 'POST',
      body: {
        group_id: Number(group.id),
        teacher_id: lesson.teacher_id,
        room_id: lesson.room_id,
        start_time: lesson.start_time,
        end_time: lesson.end_time,
        ...(lesson.subject_id ? { subject_id: lesson.subject_id } : {}),
        ...(excludeId ? { exclude_id: Number(excludeId) } : {})
      }
    });
  }

  function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

    action.run(
      async () => {
        const lesson = {
          group_id: Number(group.id),
          subject_id: Number(fields.get('subject_id')),
          teacher_id: Number(fields.get('teacher_id')),
          room_id: Number(fields.get('room_id')),
          ...interval(date, fields.get('time'), Number(fields.get('minutes')))
        };

        await validate(lesson);
        return api('/schedule', {
          token,
          method: 'POST',
          body: { ...lesson, status: 'draft' }
        });
      },
      'Заняття додано в чернетку. Батьки побачать його після публікації.',
      () => {
        form.reset();
        state.retry();
      }
    );
  }

  function move(event, lesson) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);

    action.run(
      async () => {
        const changes = {
          room_id: Number(fields.get('room_id')),
          ...interval(date, fields.get('time'), minutesBetween(lesson.start_time, lesson.end_time))
        };

        await validate({
          teacher_id: Number(lesson.teacher_id),
          subject_id: lesson.subject_id ? Number(lesson.subject_id) : null,
          ...changes
        }, lesson.id);
        return api(`/schedule/${lesson.id}`, { token, method: 'PATCH', body: changes });
      },
      'Заняття перенесено.',
      () => {
        setMoving(null);
        state.retry();
      }
    );
  }

  function remove(lesson) {
    action.run(
      () => api(`/schedule/${lesson.id}`, { token, method: 'DELETE' }),
      'Заняття прибрано з чернетки.',
      state.retry
    );
  }

  return (
    <div className="day-actions lesson-editor">
      <h3>Заняття вручну</h3>

      {lessons.length === 0 ? (
        <p className="muted">Занять на цей день ще немає.</p>
      ) : (
        <ul>
          {lessons.map(lesson => (
            <li key={lesson.id}>
              <div className="row">
                <span>
                  <strong>
                    {clock.format(new Date(lesson.start_time))}–{clock.format(new Date(lesson.end_time))}
                    {' · '}{subjectName(lesson.subject_id)}
                  </strong>
                  <small>
                    {teacherName(lesson.teacher_id)} · {roomName(lesson.room_id)}
                    {' · '}{lesson.status === 'draft' ? 'Чернетка' : 'Опубліковано'}
                  </small>
                </span>

                {lesson.status === 'draft' && moving !== lesson.id && (
                  <span className="row-actions">
                    <button disabled={locked} onClick={() => setMoving(lesson.id)}>Перенести</button>
                    <button disabled={locked} onClick={() => remove(lesson)}>Прибрати</button>
                  </span>
                )}
              </div>

              {moving === lesson.id && (
                <form onSubmit={event => move(event, lesson)}>
                  <label>
                    Новий початок
                    <input
                      name="time"
                      type="time"
                      required
                      defaultValue={clock.format(new Date(lesson.start_time))}
                    />
                  </label>
                  <RoomSelect rooms={rooms.items} value={lesson.room_id} />
                  <button disabled={locked}>Зберегти</button>{' '}
                  <button type="button" onClick={() => setMoving(null)}>Скасувати</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary>Додати заняття</summary>
        <form onSubmit={add}>
          <label>
            Предмет
            <select name="subject_id" required defaultValue="">
              <option value="">Оберіть предмет</option>
              {subjects.items?.map(subject => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
          </label>

          <label>
            Викладач
            <select name="teacher_id" required defaultValue="">
              <option value="">Оберіть викладача</option>
              {teachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.first_name} {teacher.last_name}
                </option>
              ))}
            </select>
          </label>

          <RoomSelect rooms={rooms.items} value={group.room_id} />

          <label>
            Початок
            <input name="time" type="time" defaultValue="10:00" required />
          </label>

          <label>
            Тривалість
            <select name="minutes" defaultValue="30">
              {durations.map(minutes => (
                <option key={minutes} value={minutes}>{minutes} хв</option>
              ))}
            </select>
          </label>

          <button disabled={locked}>Додати в чернетку</button>
        </form>
      </details>

      <Notice notice={action.notice} />
    </div>
  );
}

function RoomSelect({ rooms, value }) {
  return (
    <label>
      Кімната
      <select name="room_id" required defaultValue={value ?? ''} key={rooms?.length ?? 0}>
        <option value="">Оберіть кімнату</option>
        {rooms?.map(room => (
          <option key={room.id} value={room.id}>{room.name}</option>
        ))}
      </select>
    </label>
  );
}
