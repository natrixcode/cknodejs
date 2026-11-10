CREATE TABLE attendance (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    child_id BIGINT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    attendance_date DATE NOT NULL,
    present BOOLEAN NOT NULL,
    reason TEXT CHECK (reason IS NULL OR LENGTH(reason) <= 1000),
    marked_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT attendance_child_day_unique
        UNIQUE (child_id, attendance_date)
);

CREATE INDEX idx_attendance_group_date
    ON attendance(group_id, attendance_date);

-- The unique constraint already indexes child_id + attendance_date.

CREATE FUNCTION kms_attendance_today()
RETURNS DATE
LANGUAGE SQL
STABLE
AS $$
    SELECT (statement_timestamp() AT TIME ZONE 'Europe/Kyiv')::date;
$$;

CREATE FUNCTION kms_is_group_educator(
    p_user_id BIGINT,
    p_group_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN employees e ON e.id = u.employee_id
        JOIN group_staff gs ON gs.employee_id = e.id
        WHERE u.id = p_user_id
          AND u.role = 'employee'
          AND u.status = 'active'
          AND u.is_active
          AND e.status = 'active'
          AND e.position = 'educator'
          AND gs.role = 'educator'
          AND gs.group_id = p_group_id
    );
$$;

CREATE FUNCTION kms_is_attendance_manager(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users
        WHERE id = p_user_id
          AND role IN ('manager', 'admin')
          AND status = 'active'
          AND is_active
    );
$$;

CREATE FUNCTION kms_can_view_attendance(
    p_user_id BIGINT,
    p_group_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT kms_is_attendance_manager(p_user_id)
        OR kms_is_group_educator(p_user_id, p_group_id);
$$;

-- Structural protections also apply to direct table writes.
-- Authorization is enforced by the API-facing SQL functions below.
CREATE FUNCTION kms_attendance_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.attendance_date > kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FUTURE_DATE';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.child_id,
            NEW.group_id,
            NEW.attendance_date,
            NEW.marked_by,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.child_id,
            OLD.group_id,
            OLD.attendance_date,
            OLD.marked_by,
            OLD.created_at
        ) THEN
            RAISE EXCEPTION 'KMS_ATTENDANCE_IDENTITY_IMMUTABLE';
        END IF;
    END IF;

    NEW.reason := NULLIF(BTRIM(NEW.reason), '');

    IF NEW.present THEN
        NEW.reason := NULL;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_guard
BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION kms_attendance_guard();

CREATE FUNCTION kms_mark_attendance(
    p_user_id BIGINT,
    p_child_id BIGINT,
    p_date DATE,
    p_present BOOLEAN,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
    v_record attendance%ROWTYPE;
    v_created BOOLEAN;
BEGIN
    -- Require an active educator even before looking up a child.
    IF NOT EXISTS (
        SELECT 1
        FROM users u
        JOIN employees e ON e.id = u.employee_id
        JOIN group_staff gs ON gs.employee_id = e.id
        WHERE u.id = p_user_id
          AND u.role = 'employee'
          AND u.status = 'active'
          AND u.is_active
          AND e.status = 'active'
          AND e.position = 'educator'
          AND gs.role = 'educator'
    ) THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    IF p_child_id IS NULL
       OR p_date IS NULL
       OR p_present IS NULL
       OR LENGTH(p_reason) > 1000 THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF p_date > kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FUTURE_DATE';
    END IF;

    IF p_date < kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_PAST_FORBIDDEN';
    END IF;

    -- Serializes marks for this child and prevents concurrent transfer.
    SELECT *
    INTO v_child
    FROM children
    WHERE id = p_child_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    -- Issue #52: add the archive check here when archive fields exist.

    -- Lock the assignment and user records while applying the mark.
    PERFORM u.id
    FROM users u
    JOIN employees e ON e.id = u.employee_id
    JOIN group_staff gs ON gs.employee_id = e.id
    WHERE u.id = p_user_id
      AND u.role = 'employee'
      AND u.status = 'active'
      AND u.is_active
      AND e.status = 'active'
      AND e.position = 'educator'
      AND gs.role = 'educator'
      AND gs.group_id = v_child.group_id
    FOR SHARE OF u, e, gs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    INSERT INTO attendance (
        child_id,
        group_id,
        attendance_date,
        present,
        reason,
        marked_by,
        updated_by
    )
    VALUES (
        v_child.id,
        v_child.group_id,
        p_date,
        p_present,
        p_reason,
        p_user_id,
        p_user_id
    )
    ON CONFLICT (child_id, attendance_date) DO NOTHING
    RETURNING * INTO v_record;

    v_created := FOUND;

    IF NOT v_created THEN
        SELECT *
        INTO v_record
        FROM attendance
        WHERE child_id = p_child_id
          AND attendance_date = p_date
        FOR UPDATE;

        -- Do not rewrite the historical group after a same-day transfer.
        IF v_record.group_id <> v_child.group_id THEN
            RAISE EXCEPTION 'KMS_ATTENDANCE_GROUP_CHANGED';
        END IF;

        UPDATE attendance
        SET present = p_present,
            reason = p_reason,
            updated_by = p_user_id
        WHERE id = v_record.id
        RETURNING * INTO v_record;
    END IF;

    RETURN jsonb_build_object(
        'created', v_created,
        'record', to_jsonb(v_record)
    );
END;
$$;

-- JSONB preserves PATCH semantics:
-- omitted reason = keep existing; reason: null = clear.
CREATE FUNCTION kms_correct_attendance(
    p_user_id BIGINT,
    p_attendance_id BIGINT,
    p_changes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_record attendance%ROWTYPE;
    v_present BOOLEAN;
    v_reason TEXT;
BEGIN
    PERFORM id
    FROM users
    WHERE id = p_user_id
      AND role IN ('manager', 'admin')
      AND status = 'active'
      AND is_active
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    IF p_attendance_id IS NULL
       OR p_changes IS NULL
       OR jsonb_typeof(p_changes) <> 'object'
       OR p_changes = '{}'::jsonb THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_object_keys(p_changes) AS fields(key)
        WHERE key NOT IN ('present', 'reason')
    ) THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF p_changes ? 'present'
       AND jsonb_typeof(p_changes -> 'present') <> 'boolean' THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF p_changes ? 'reason' THEN
        IF jsonb_typeof(p_changes -> 'reason') NOT IN ('string', 'null')
           OR LENGTH(p_changes ->> 'reason') > 1000 THEN
            RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
        END IF;
    END IF;

    SELECT *
    INTO v_record
    FROM attendance
    WHERE id = p_attendance_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_NOT_FOUND';
    END IF;

    IF v_record.attendance_date >= kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_CORRECTION_REQUIRES_PAST';
    END IF;

    v_present := CASE
        WHEN p_changes ? 'present'
            THEN (p_changes ->> 'present')::boolean
        ELSE v_record.present
    END;

    v_reason := CASE
        WHEN p_changes ? 'reason'
            THEN p_changes ->> 'reason'
        ELSE v_record.reason
    END;

    UPDATE attendance
    SET present = v_present,
        reason = v_reason,
        updated_by = p_user_id
    WHERE id = p_attendance_id
    RETURNING * INTO v_record;

    RETURN to_jsonb(v_record);
END;
$$;

CREATE FUNCTION kms_group_attendance(
    p_user_id BIGINT,
    p_group_id BIGINT,
    p_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT kms_can_view_attendance(p_user_id, p_group_id) THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    IF p_date IS NULL THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF p_date > kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FUTURE_DATE';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id) THEN
        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';
    END IF;

    -- Past reports use recorded membership only.
    -- Today's report also includes children not marked yet.
    WITH candidates AS (
        SELECT a.child_id
        FROM attendance a
        WHERE a.group_id = p_group_id
          AND a.attendance_date = p_date

        UNION

        SELECT c.id
        FROM children c
        WHERE c.group_id = p_group_id
          AND p_date = kms_attendance_today()
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'child_id', c.id,
                'first_name', c.first_name,
                'last_name', c.last_name,
                'attendance', CASE
                    WHEN a.id IS NULL THEN NULL
                    ELSE to_jsonb(a)
                END
            )
            ORDER BY c.last_name, c.first_name, c.id
        ),
        '[]'::jsonb
    )
    INTO v_result
    FROM candidates candidate
    JOIN children c ON c.id = candidate.child_id
    LEFT JOIN attendance a
      ON a.child_id = c.id
     AND a.group_id = p_group_id
     AND a.attendance_date = p_date;

    RETURN v_result;
END;
$$;

-- p_month must be the first calendar day of the requested month.
CREATE FUNCTION kms_child_attendance_month(
    p_user_id BIGINT,
    p_child_id BIGINT,
    p_month DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_group_id BIGINT;
    v_manager BOOLEAN;
    v_result JSONB;
BEGIN
    v_manager := kms_is_attendance_manager(p_user_id);

    SELECT group_id
    INTO v_group_id
    FROM children
    WHERE id = p_child_id;

    IF NOT FOUND THEN
        IF NOT v_manager THEN
            RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
        END IF;
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    IF NOT v_manager
       AND NOT kms_is_group_educator(p_user_id, v_group_id) THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    IF p_month IS NULL
       OR EXTRACT(DAY FROM p_month) <> 1 THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    IF p_month > kms_attendance_today() THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FUTURE_DATE';
    END IF;

    SELECT COALESCE(
        jsonb_agg(to_jsonb(a) ORDER BY a.attendance_date),
        '[]'::jsonb
    )
    INTO v_result
    FROM attendance a
    WHERE a.child_id = p_child_id
      AND a.attendance_date >= p_month
      AND a.attendance_date < (p_month + INTERVAL '1 month')::date
      AND (
          v_manager
          OR kms_is_group_educator(p_user_id, a.group_id)
      );

    RETURN v_result;
END;
$$;

-- Issue #55 owns enabling audit when it merges after attendance.
-- If it has already merged, enable audit now.
DO $$
BEGIN
    IF to_regprocedure('kms_enable_audit(text)') IS NOT NULL THEN
        EXECUTE 'SELECT kms_enable_audit(''attendance'')';
    ELSIF to_regprocedure('kms_enable_audit(regclass)') IS NOT NULL THEN
        EXECUTE 'SELECT kms_enable_audit(''attendance''::regclass)';
    END IF;
END;
$$;