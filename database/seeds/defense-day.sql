\getenv local_hash CK_HASH
BEGIN;

SET LOCAL TIME ZONE 'Europe/Kyiv';
SELECT pg_advisory_xact_lock(2026, 1125);

DO $$
BEGIN
  IF current_database() <> 'ck_defense' OR
     (SELECT count(*) FROM groups WHERE status = 'active') <> 6 THEN
    RAISE EXCEPTION 'Expected the six presentation groups in ck_defense';
  END IF;
END $$;

INSERT INTO users(
  username, name, password_hash, role, employee_id, parent_id, status, is_active
)
SELECT u.login, u.full_name, :'local_hash', u.role,
       u.employee_id, u.parent_id, 'active', true
FROM (
  SELECT 'sadok_manager' AS login, 'Ольга Коваль' AS full_name,
         'manager' AS role, NULL::bigint AS employee_id, NULL::bigint AS parent_id
  UNION ALL
  SELECT split_part(email, '@', 1), first_name || ' ' || last_name,
         'employee', id, NULL
  FROM employees
  WHERE email LIKE '%@sadok.example'
  UNION ALL
  SELECT 'sadok_parent', first_name || ' ' || last_name,
         'parent', NULL, id
  FROM parents
  WHERE email = 'family1@sadok.example'
) u
ON CONFLICT (username) DO NOTHING;

DO $$
DECLARE
  g record;
  c record;
  d date;
  offset_days int;
  inv invoices%ROWTYPE;
  month_start date := date_trunc('month', current_date)::date;
BEGIN
  FOR g IN SELECT id FROM groups ORDER BY id LOOP
    FOR offset_days IN 0..1 LOOP
      d := current_date + offset_days;

      IF NOT EXISTS (
        SELECT FROM kms_group_day_windows WHERE group_id = g.id AND block_date = d
      ) THEN
        INSERT INTO kms_daily_blocks(group_id, block_date, kind, start_time, end_time)
        SELECT g.id, d, kind,
               (d + t) AT TIME ZONE 'Europe/Kyiv',
               ((d + t) AT TIME ZONE 'Europe/Kyiv') + duration
        FROM (VALUES
          ('meal', time '08:30', interval '30 minutes'),
          ('meal', time '12:00', interval '30 minutes'),
          ('nap',  time '13:00', interval '60 minutes'),
          ('meal', time '15:00', interval '30 minutes')
        ) b(kind, t, duration);

        PERFORM kms_generate_group_day(g.id, d);
        PERFORM kms_publish_group_day(g.id, d, time '08:00');
      END IF;
    END LOOP;
  END LOOP;

  FOR c IN
    SELECT ch.id, u.id AS educator,
           row_number() OVER (PARTITION BY ch.group_id ORDER BY ch.id) AS num
    FROM children ch
    JOIN group_staff gs ON gs.group_id = ch.group_id AND gs.role = 'educator'
    JOIN users u ON u.employee_id = gs.employee_id
    ORDER BY ch.id
  LOOP
    IF c.num < 14 AND NOT EXISTS (
      SELECT FROM attendance WHERE child_id = c.id AND attendance_date = current_date
    ) THEN
      PERFORM kms_mark_attendance(
        c.educator, c.id, current_date, c.num <> 4,
        CASE WHEN c.num = 4 THEN 'За повідомленням батьків' END
      );
    END IF;

    IF NOT EXISTS (
      SELECT FROM invoices WHERE child_id = c.id AND period_start = month_start
    ) THEN
      SELECT * INTO inv FROM kms_issue_invoice(c.id, month_start, 1, 18);

      IF c.num <= 8 THEN
        PERFORM kms_register_payment(
          inv.id, inv.total_amount, 'bank_transfer', 'SADOK-' || inv.id
        );
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;