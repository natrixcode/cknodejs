-- 0011: Database access checks and audit

-- Таблиця історії змін

CREATE TABLE kms_audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_key TEXT,
    operation VARCHAR(10) NOT NULL
        CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    actor_user_id BIGINT REFERENCES users(id)
        ON DELETE SET NULL,
    database_user TEXT NOT NULL DEFAULT session_user,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_kms_audit_table
ON kms_audit_log(table_name, changed_at);

CREATE INDEX idx_kms_audit_actor
ON kms_audit_log(actor_user_id);


-- Універсальна функція журналювання

CREATE OR REPLACE FUNCTION kms_audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old JSONB;
    v_new JSONB;
    v_key TEXT;
    v_actor_text TEXT;
    v_actor_id BIGINT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new := to_jsonb(NEW);
    END IF;

    v_key := COALESCE(
        v_new ->> 'id',
        v_old ->> 'id',
        CONCAT_WS(
            ':',
            COALESCE(v_new, v_old) ->> 'child_id',
            COALESCE(v_new, v_old) ->> 'parent_id',
            COALESCE(v_new, v_old) ->> 'group_id',
            COALESCE(v_new, v_old) ->> 'employee_id'
        )
    );

    -- Ідентифікатор передається довіреним
    -- серверним компонентом у межах транзакції.
    -- Сам по собі параметр сесії не є доказом особи.
    v_actor_text := NULLIF(
        current_setting('kms.actor_user_id', true),
        ''
    );

    IF v_actor_text ~ '^[0-9]+$' THEN
        v_actor_id := v_actor_text::BIGINT;
    END IF;

    INSERT INTO kms_audit_log (
        table_name, record_key, operation,
        old_data, new_data, actor_user_id
    )
    VALUES (
        TG_TABLE_NAME,
        v_key,
        TG_OP,
        v_old,
        v_new,
        v_actor_id
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


-- Підключаємо аудит до важливих таблиць

DO $audit$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'children',
        'parents',
        'children_parents',
        'child_relatives',
        'groups',
        'rooms',
        'employees',
        'group_staff',
        'subjects',
        'employee_subjects',
        'schedule',
        'kms_daily_blocks',
        'meal_prices',
        'tuition_rates',
        'discounts',
        'child_discounts',
        'invoices',
        'payments',
        'salaries',
        'expenses',
        'kms_salary_parameters',
        'settings'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_kms_audit
             AFTER INSERT OR UPDATE OR DELETE
             ON %I FOR EACH ROW
             EXECUTE FUNCTION kms_audit_row()',
            v_table
        );
    END LOOP;
END;
$audit$;


-- Перевірка доступу до дитини

CREATE OR REPLACE FUNCTION kms_can_view_child(
    p_user_id BIGINT,
    p_child_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role IN ('admin', 'manager')

              OR (
                  u.role = 'parent'
                  AND EXISTS (
                      SELECT 1
                      FROM children_parents cp
                      WHERE cp.parent_id = u.parent_id
                        AND cp.child_id = p_child_id
                  )
              )

              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM group_staff gs
                      JOIN children c
                        ON c.group_id = gs.group_id
                      WHERE gs.employee_id = u.employee_id
                        AND c.id = p_child_id
                  )
              )
          )
    );
$$;


-- Доступ до рахунка
-- Фінансові дані бачать адміністратор і
-- батьки відповідної дитини.

CREATE OR REPLACE FUNCTION kms_can_view_invoice(
    p_user_id BIGINT,
    p_invoice_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM invoices i
        JOIN users u ON u.id = p_user_id
        WHERE i.id = p_invoice_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role = 'admin'
              OR (
                  u.role = 'parent'
                  AND kms_can_view_child(u.id, i.child_id)
              )
          )
    );
$$;


-- Викладач може працювати лише
-- зі своїм заняттям, адміністратор
-- та менеджер — зі своїми дозволеними операціями.

CREATE OR REPLACE FUNCTION kms_can_manage_lesson(
    p_user_id BIGINT,
    p_lesson_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN schedule s ON s.id = p_lesson_id
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role IN ('admin', 'manager')
              OR (
                  u.role = 'teacher'
                  AND u.employee_id = s.teacher_id
              )
          )
    );
$$;


-- Перевірка адміністративних прав

CREATE OR REPLACE FUNCTION kms_can_manage_area(
    p_user_id BIGINT,
    p_area TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role = 'admin'
              OR (
                  u.role = 'manager'
                  AND p_area IN (
                      'children',
                      'parents',
                      'groups',
                      'rooms',
                      'schedule'
                  )
              )
          )
    );
$$;


-- Не дозволяємо загальний доступ
-- до журналу через PUBLIC.

REVOKE ALL ON kms_audit_log FROM PUBLIC;