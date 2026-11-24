BEGIN;

SELECT pg_advisory_xact_lock(2026, 1125);

DO $$
DECLARE
  titles text[] := ARRAY[
    'Сонечко', 'Росинка', 'Веселка',
    'Дзвіночок', 'Барвінок', 'Ластівка'
  ];
  ages int[] := ARRAY[2, 3, 3, 4, 4, 5];
  names text[] := ARRAY[
    'Софія', 'Марко', 'Соломія', 'Лев', 'Марта', 'Данило', 'Емілія',
    'Остап', 'Злата', 'Тимофій', 'Ярина', 'Максим', 'Анна', 'Петро'
  ];
  surnames text[] := ARRAY[
    'Коваль', 'Бондар', 'Шевченко', 'Мельник', 'Левченко', 'Поліщук',
    'Савчук', 'Мороз', 'Гончар', 'Ткач', 'Романюк', 'Кравченко',
    'Лисенко', 'Швець'
  ];
  adults text[] := ARRAY['Олена', 'Ірина', 'Наталя', 'Любов', 'Оксана', 'Галина'];

  rid bigint;
  gid bigint;
  eid bigint;
  cid bigint;
  pid bigint;
  n int;
  family text;
  job text;
BEGIN
  IF current_database() <> 'ck_defense' THEN
    RAISE EXCEPTION 'Expected ck_defense';
  END IF;

  IF EXISTS (SELECT FROM groups) OR EXISTS (SELECT FROM children)
     OR EXISTS (SELECT FROM employees) OR EXISTS (SELECT FROM parents)
     OR EXISTS (SELECT FROM rooms) OR EXISTS (SELECT FROM subjects) THEN
    RAISE EXCEPTION 'Roster already exists. Inspect it before continuing.';
  END IF;

  INSERT INTO subjects(name)
  VALUES ('Музика'), ('Малювання'), ('Цікава математика');

  FOR g IN 1..6 LOOP
    INSERT INTO rooms(name, capacity)
    VALUES ('Кімната ' || g, 20)
    RETURNING id INTO rid;

    INSERT INTO groups(name, room_id, age_years, max_capacity, status)
    VALUES (titles[g], rid, ages[g], 18, 'draft')
    RETURNING id INTO gid;

    FOREACH job IN ARRAY ARRAY['educator', 'assistant', 'teacher'] LOOP
      INSERT INTO employees(first_name, last_name, email, phone, position, salary)
      VALUES (
        adults[g],
        surnames[g + CASE job WHEN 'educator' THEN 0 WHEN 'assistant' THEN 3 ELSE 6 END],
        job || g || '@sadok.example',
        '+38000000' || (1000 + 3*g + CASE job WHEN 'educator' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END),
        job,
        CASE job WHEN 'teacher' THEN 20000 WHEN 'educator' THEN 18000 ELSE 14000 END
      )
      RETURNING id INTO eid;

      IF job = 'teacher' THEN
        INSERT INTO employee_subjects(employee_id, subject_id)
        SELECT eid, id FROM subjects;
      ELSE
        INSERT INTO group_staff(group_id, employee_id, role)
        VALUES (gid, eid, job);
      END IF;
    END LOOP;

    UPDATE groups SET status = 'active' WHERE id = gid;

    FOR j IN 1..14 LOOP
      n := (g - 1) * 14 + j;
      family := surnames[1 + (j + g - 2) % 14];

      INSERT INTO children(first_name, last_name, date_of_birth, group_id)
      VALUES (
        names[j], family,
        (current_date - make_interval(years => ages[g], days => 40 + n))::date,
        gid
      )
      RETURNING id INTO cid;

      INSERT INTO parents(first_name, last_name, phone, email)
      VALUES (
        adults[1 + (j + g - 2) % 6], family,
        '+38000000' || (2000 + n),
        'family' || n || '@sadok.example'
      )
      RETURNING id INTO pid;

      INSERT INTO children_parents(child_id, parent_id, relationship_type)
      VALUES (cid, pid, 'parent');
    END LOOP;
  END LOOP;
END $$;

COMMIT;