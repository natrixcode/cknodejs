-- Migration 0022: Archive children and parents (Issue #52)
-- Kindergarten Management System
-- Rules:
-- 1. Soft delete: children and parents are never physically deleted.
-- 2. Status 'active' or 'archived'. Archived children are removed from groups.
-- 3. Invoices and payments remain intact; existing debt can be paid.
-- 4. New invoices cannot be issued for archived children.
-- 5. Parents are automatically archived when all their children are archived.
-- 6. Unarchiving a child restores parents to active status.

-- ============================================================
-- 1. Add status, archived_at, archive_reason to children
-- ============================================================
ALTER TABLE children
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archive_reason TEXT;

ALTER TABLE children
    ADD CONSTRAINT chk_children_archive_consistency
        CHECK ((status = 'active' AND archived_at IS NULL)
            OR (status = 'archived' AND archived_at IS NOT NULL));

ALTER TABLE children
    ADD CONSTRAINT chk_children_archived_no_group
        CHECK (status <> 'archived' OR group_id IS NULL);

CREATE INDEX idx_children_status ON children(status);

-- ============================================================
-- 2. Add status, archived_at, archive_reason to parents
-- ============================================================
ALTER TABLE parents
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archive_reason TEXT;

ALTER TABLE parents
    ADD CONSTRAINT chk_parents_archive_consistency
        CHECK ((status = 'active' AND archived_at IS NULL)
            OR (status = 'archived' AND archived_at IS NOT NULL));

CREATE INDEX idx_parents_status ON parents(status);

-- ============================================================
-- 3. Guard against assigning group to archived child
-- ============================================================
CREATE OR REPLACE FUNCTION kms_children_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_age INTEGER;
    v_excluded_child_id BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1001);

    IF NEW.status = 'archived' AND NEW.group_id IS NOT NULL THEN
        RAISE EXCEPTION 'KMS_CANNOT_ASSIGN_ARCHIVED_CHILD';
    END IF;

    v_age := calculate_child_age(
        NEW.date_of_birth
    );

    IF v_age IS NULL
       OR v_age NOT BETWEEN 2 AND 5 THEN
        RAISE EXCEPTION 'KMS_CHILD_AGE_OUT_OF_RANGE';
    END IF;

    IF NEW.group_id IS NOT NULL THEN
        v_excluded_child_id := NULL;

        IF TG_OP = 'UPDATE' THEN
            v_excluded_child_id := OLD.id;
        END IF;

        PERFORM validate_group_assignment(
            NEW.date_of_birth,
            NEW.group_id,
            v_excluded_child_id
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kms_children_guard ON children;
CREATE TRIGGER trg_kms_children_guard
BEFORE INSERT OR UPDATE OF
    date_of_birth, group_id, status
ON children
FOR EACH ROW
EXECUTE FUNCTION kms_children_guard();

-- ============================================================
-- 4. Function: kms_archive_child
-- ============================================================
CREATE OR REPLACE FUNCTION kms_archive_child(
    p_child_id BIGINT,
    p_reason TEXT DEFAULT NULL,
    p_archived_at TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS children
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
    v_parent_id BIGINT;
    v_ts TIMESTAMPTZ := COALESCE(p_archived_at, clock_timestamp());
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1052);

    SELECT * INTO v_child
    FROM children
    WHERE id = p_child_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    IF v_child.status = 'archived' THEN
        RAISE EXCEPTION 'KMS_CHILD_ALREADY_ARCHIVED';
    END IF;

    -- Remove from group and set status to archived
    UPDATE children
    SET status = 'archived',
        archived_at = v_ts,
        archive_reason = p_reason,
        group_id = NULL
    WHERE id = p_child_id
    RETURNING * INTO v_child;

    -- Automatically archive parents if they have no other active children
    FOR v_parent_id IN
        SELECT cp.parent_id
        FROM children_parents cp
        WHERE cp.child_id = p_child_id
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM children_parents cp2
            JOIN children c2 ON c2.id = cp2.child_id
            WHERE cp2.parent_id = v_parent_id
              AND c2.id <> p_child_id
              AND c2.status = 'active'
        ) THEN
            UPDATE parents
            SET status = 'archived',
                archived_at = v_ts,
                archive_reason = COALESCE(p_reason, 'Всі діти в архіві')
            WHERE id = v_parent_id
              AND status = 'active';
        END IF;
    END LOOP;

    RETURN v_child;
END;
$$;

-- ============================================================
-- 5. Function: kms_unarchive_child
-- ============================================================
CREATE OR REPLACE FUNCTION kms_unarchive_child(
    p_child_id BIGINT
)
RETURNS children
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
    v_parent_id BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1052);

    SELECT * INTO v_child
    FROM children
    WHERE id = p_child_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    IF v_child.status <> 'archived' THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_ARCHIVED';
    END IF;

    -- Restore child to active status (without group)
    UPDATE children
    SET status = 'active',
        archived_at = NULL,
        archive_reason = NULL
    WHERE id = p_child_id
    RETURNING * INTO v_child;

    -- Restore child's parents to active status
    FOR v_parent_id IN
        SELECT cp.parent_id
        FROM children_parents cp
        WHERE cp.child_id = p_child_id
    LOOP
        UPDATE parents
        SET status = 'active',
            archived_at = NULL,
            archive_reason = NULL
        WHERE id = v_parent_id
          AND status = 'archived';
    END LOOP;

    RETURN v_child;
END;
$$;

-- ============================================================
-- 6. Disallow issuing invoices to archived children
-- ============================================================
CREATE OR REPLACE FUNCTION kms_issue_invoice(
    p_child_id BIGINT,
    p_start_date DATE,
    p_months INTEGER,
    p_meal_days INTEGER
)
RETURNS invoices
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
    v_end_date DATE;
    v_tuition RECORD;
    v_meal NUMERIC;
    v_result invoices%ROWTYPE;
BEGIN
    IF p_start_date IS NULL
       OR EXTRACT(DAY FROM p_start_date) <> 1
       OR p_months IS NULL OR p_months NOT IN (1, 12)
       OR p_meal_days IS NULL
       OR p_meal_days < 0
       OR (p_months = 1 AND p_meal_days > 31)
       OR (p_months = 12 AND p_meal_days > 366)
    THEN
        RAISE EXCEPTION 'KMS_INVALID_INVOICE_PERIOD';
    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1008);

    SELECT * INTO v_child
    FROM children WHERE id = p_child_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    IF v_child.status = 'archived' THEN
        RAISE EXCEPTION 'KMS_CHILD_ARCHIVED';
    END IF;

    SELECT * INTO v_tuition
    FROM kms_calculate_tuition(
        p_child_id, p_start_date, p_months
    );

    v_meal := kms_calculate_child_meal(
        p_child_id, p_meal_days, p_start_date
    );

    v_end_date := (
        p_start_date
        + make_interval(months => p_months)
        - INTERVAL '1 day'
    )::DATE;

    INSERT INTO invoices (
        child_id,
        period_start,
        period_end,
        currency,
        tuition_amount,
        meal_amount,
        discount_amount,
        parameters,
        status
    )
    VALUES (
        p_child_id,
        p_start_date,
        v_end_date,
        'UAH',
        v_tuition.gross_amount,
        v_meal,
        v_tuition.personal_discount
            + v_tuition.annual_discount,
        jsonb_build_object(
            'months', p_months,
            'meal_days', p_meal_days,
            'group_id', v_child.group_id,
            'personal_discount',
                v_tuition.personal_discount,
            'annual_discount',
                v_tuition.annual_discount
        ),
        'issued'
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- ============================================================
-- 7. Ensure employees cannot view archived children
-- ============================================================
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
        CROSS JOIN children c
        WHERE u.id = p_user_id
          AND c.id = p_child_id
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
                  c.status = 'active'
                  AND u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM group_staff gs
                      WHERE gs.employee_id = u.employee_id
                        AND gs.group_id = c.group_id
                  )
              )
          )
    );
$$;
