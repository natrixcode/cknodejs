-- Migration 0025: Audit log protection and history access (Issue #55)
-- Kindergarten Management System
-- Rules:
-- 1. Immutable audit log: UPDATE, DELETE, TRUNCATE on kms_audit_log are forbidden.
-- 2. Prevent TRUNCATE on all data tables (TRUNCATE bypasses row-level audit triggers).
-- 3. Mask sensitive fields: password_hash in users table is masked as '***'.
-- 4. Enable audit triggers on previously unmonitored tables: users, food_rates, kms_group_day_windows.
-- 5. Helper SQL functions for API: kms_get_record_history, kms_get_record_state_at.

-- ============================================================
-- 1. Protect kms_audit_log from any mutation (KMS_AUDIT_IMMUTABLE)
-- ============================================================
CREATE OR REPLACE FUNCTION kms_protect_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'KMS_AUDIT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_kms_audit_log_immutable_row ON kms_audit_log;
CREATE TRIGGER trg_kms_audit_log_immutable_row
BEFORE UPDATE OR DELETE ON kms_audit_log
FOR EACH ROW
EXECUTE FUNCTION kms_protect_audit_log();

DROP TRIGGER IF EXISTS trg_kms_audit_log_immutable_stmt ON kms_audit_log;
CREATE TRIGGER trg_kms_audit_log_immutable_stmt
BEFORE TRUNCATE ON kms_audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION kms_protect_audit_log();

-- ============================================================
-- 2. Prevent TRUNCATE on all data tables
-- ============================================================
CREATE OR REPLACE FUNCTION kms_prevent_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'KMS_TRUNCATE_FORBIDDEN';
END;
$$;

DO $truncate_protect$
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
        'food_rates',
        'discounts',
        'child_discounts',
        'invoices',
        'payments',
        'salaries',
        'expenses',
        'kms_salary_parameters',
        'settings',
        'users',
        'kms_group_day_windows'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = v_table
        ) THEN
            EXECUTE format(
                'DROP TRIGGER IF EXISTS trg_kms_prevent_truncate ON %I;
                 CREATE TRIGGER trg_kms_prevent_truncate
                 BEFORE TRUNCATE ON %I
                 FOR EACH STATEMENT
                 EXECUTE FUNCTION kms_prevent_truncate()',
                v_table, v_table
            );
        END IF;
    END LOOP;
END;
$truncate_protect$;

-- ============================================================
-- 3. Mask sensitive data (password_hash) in kms_audit_row()
-- ============================================================
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

    -- Mask sensitive password_hash in users table
    IF TG_TABLE_NAME = 'users' THEN
        IF v_old IS NOT NULL AND v_old ? 'password_hash' THEN
            v_old := jsonb_set(v_old, '{password_hash}', '"***"');
        END IF;
        IF v_new IS NOT NULL AND v_new ? 'password_hash' THEN
            v_new := jsonb_set(v_new, '{password_hash}', '"***"');
        END IF;
    END IF;

    v_key := COALESCE(
        v_new ->> 'id',
        v_old ->> 'id',
        CONCAT_WS(
            ':',
            COALESCE(v_new, v_old) ->> 'child_id',
            COALESCE(v_new, v_old) ->> 'parent_id',
            COALESCE(v_new, v_old) ->> 'group_id',
            COALESCE(v_new, v_old) ->> 'employee_id',
            COALESCE(v_new, v_old) ->> 'subject_id'
        )
    );

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

-- ============================================================
-- 4. Enable audit on users, food_rates, kms_group_day_windows
-- ============================================================
DO $audit_extra$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'users',
        'food_rates',
        'kms_group_day_windows'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = v_table
        ) THEN
            EXECUTE format(
                'DROP TRIGGER IF EXISTS trg_kms_audit ON %I;
                 CREATE TRIGGER trg_kms_audit
                 AFTER INSERT OR UPDATE OR DELETE
                 ON %I FOR EACH ROW
                 EXECUTE FUNCTION kms_audit_row()',
                v_table, v_table
            );
        END IF;
    END LOOP;
END;
$audit_extra$;

-- ============================================================
-- 5. Helper SQL functions for history access
-- ============================================================
CREATE OR REPLACE FUNCTION kms_get_record_history(
    p_table_name TEXT,
    p_record_key TEXT
)
RETURNS TABLE (
    id BIGINT,
    table_name TEXT,
    record_key TEXT,
    operation VARCHAR(10),
    old_data JSONB,
    new_data JSONB,
    actor_user_id BIGINT,
    database_user TEXT,
    changed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
AS $$
    SELECT
        a.id,
        a.table_name,
        a.record_key,
        a.operation,
        a.old_data,
        a.new_data,
        a.actor_user_id,
        a.database_user,
        a.changed_at
    FROM kms_audit_log a
    WHERE a.table_name = p_table_name
      AND a.record_key = p_record_key
    ORDER BY a.id ASC;
$$;

CREATE OR REPLACE FUNCTION kms_get_record_state_at(
    p_table_name TEXT,
    p_record_key TEXT,
    p_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_last_op VARCHAR(10);
    v_last_data JSONB;
BEGIN
    SELECT operation, new_data
    INTO v_last_op, v_last_data
    FROM kms_audit_log
    WHERE table_name = p_table_name
      AND record_key = p_record_key
      AND changed_at <= p_timestamp
    ORDER BY changed_at DESC, id DESC
    LIMIT 1;

    IF NOT FOUND OR v_last_op = 'DELETE' THEN
        RETURN NULL;
    END IF;

    RETURN v_last_data;
END;
$$;

