-- Kindergarten demo seed
-- Idempotent: safe to execute repeatedly.
-- Never delete existing business data.

BEGIN;

INSERT INTO rooms (name, capacity, status)
VALUES
  ('Demo Room A', 20, 'available'),
  ('Demo Room B', 20, 'available')
ON CONFLICT (name) DO NOTHING;

INSERT INTO subjects (name, description)
VALUES
  ('Demo Mathematics', 'Demo mathematics lesson'),
  ('Demo Art', 'Demo creative activities')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Demo employees and groups
-- These statements are safe to rerun.

BEGIN;

INSERT INTO employees (
  first_name, last_name, email, phone,
  position, salary, status
)
VALUES
  ('Demo', 'Educator One', 'demo.educator1@example.test', '+380000000101', 'educator', 18000, 'active'),
  ('Demo', 'Assistant One', 'demo.assistant1@example.test', '+380000000102', 'assistant', 14000, 'active'),
  ('Demo', 'Educator Two', 'demo.educator2@example.test', '+380000000103', 'educator', 18000, 'active'),
  ('Demo', 'Assistant Two', 'demo.assistant2@example.test', '+380000000104', 'assistant', 14000, 'active'),
  ('Demo', 'Teacher', 'demo.teacher@example.test', '+380000000105', 'teacher', 20000, 'active')
ON CONFLICT (email) DO NOTHING;

INSERT INTO groups (
  name, room_id, age_years, max_capacity, status
)
SELECT
  'Demo Group 3',
  id,
  3,
  15,
  'draft'
FROM rooms
WHERE name = 'Demo Room A'
ON CONFLICT (name) DO NOTHING;

INSERT INTO groups (
  name, room_id, age_years, max_capacity, status
)
SELECT
  'Demo Group 4',
  id,
  4,
  15,
  'draft'
FROM rooms
WHERE name = 'Demo Room B'
ON CONFLICT (name) DO NOTHING;

INSERT INTO group_staff (group_id, employee_id, role)
SELECT g.id, e.id, e.position
FROM groups g
JOIN employees e
  ON (
    (g.name = 'Demo Group 3' AND e.email IN (
      'demo.educator1@example.test',
      'demo.assistant1@example.test'
    ))
    OR
    (g.name = 'Demo Group 4' AND e.email IN (
      'demo.educator2@example.test',
      'demo.assistant2@example.test'
    ))
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM group_staff gs
  WHERE gs.group_id = g.id
    AND gs.employee_id = e.id
);

UPDATE groups
SET status = 'active'
WHERE name IN ('Demo Group 3', 'Demo Group 4')
  AND status = 'draft';

COMMIT;

-- Demo parents
INSERT INTO parents (
  first_name, last_name, phone, email
)
VALUES
  ('Olena', 'Demo', '+380000000201', 'demo.parent1@example.test'),
  ('Andrii', 'Demo', '+380000000202', 'demo.parent2@example.test')
ON CONFLICT (email) DO NOTHING;

-- Demo children
INSERT INTO children (
  first_name, last_name, date_of_birth, group_id
)
SELECT
  'Sofia', 'Demo',
  (CURRENT_DATE - INTERVAL '3 years 3 months')::date,
  g.id
FROM groups g
WHERE g.name = 'Demo Group 3'
  AND NOT EXISTS (
    SELECT 1 FROM children
    WHERE first_name = 'Sofia'
      AND last_name = 'Demo'
  );

INSERT INTO children (
  first_name, last_name, date_of_birth, group_id
)
SELECT
  'Marko', 'Demo',
  (CURRENT_DATE - INTERVAL '4 years 3 months')::date,
  g.id
FROM groups g
WHERE g.name = 'Demo Group 4'
  AND NOT EXISTS (
    SELECT 1 FROM children
    WHERE first_name = 'Marko'
      AND last_name = 'Demo'
  );

-- Link children with parents
INSERT INTO children_parents (
  child_id, parent_id, relationship_type
)
SELECT c.id, p.id, 'parent'
FROM children c
JOIN parents p
  ON (
    c.first_name = 'Sofia'
    AND p.email = 'demo.parent1@example.test'
  )
  OR (
    c.first_name = 'Marko'
    AND p.email = 'demo.parent2@example.test'
  )
WHERE c.last_name = 'Demo'
ON CONFLICT (child_id, parent_id) DO NOTHING;

-- Demo invoices
INSERT INTO invoices (
  child_id,
  period_start,
  period_end,
  tuition_amount,
  meal_amount,
  discount_amount,
  status
)
SELECT
  c.id,
  DATE '2026-11-01',
  DATE '2026-11-30',
  8000,
  1500,
  0,
  'issued'
FROM children c
WHERE c.last_name = 'Demo'
  AND c.first_name IN ('Sofia', 'Marko')
  AND NOT EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i.child_id = c.id
      AND daterange(i.period_start, i.period_end, '[]')
          && daterange(DATE '2026-11-01', DATE '2026-11-30', '[]')
      AND i.status <> 'cancelled'
  );
