-- Keep the legacy teacher user role accepted by 0001, as well as the
-- employee role used by the API. Teacher is an employee position.
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
                  u.role IN ('employee', 'teacher')
                  AND EXISTS (
                      SELECT 1 FROM employees e
                      WHERE e.id = u.employee_id
                        AND e.id = s.teacher_id
                        AND e.position = 'teacher'
                        AND e.status = 'active'
                  )
              )
          )
    );
$$;

-- Publication must retain the window supplied by its caller.
CREATE TABLE kms_group_day_windows (
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    block_date DATE NOT NULL,
    day_start TIME NOT NULL,
    PRIMARY KEY (group_id, block_date)
);

-- Same counts and eight elapsed hours as 0005; no new coverage rule.
CREATE FUNCTION kms_validate_group_day(
    p_group_id BIGINT, p_day DATE, p_day_start TIME
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_meals INTEGER;
    v_naps INTEGER;
BEGIN
    IF p_group_id IS NULL OR p_day IS NULL OR p_day_start IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_DAY_PARAMETERS';
    END IF;
    v_start := (p_day + p_day_start) AT TIME ZONE 'Europe/Kyiv';
    v_end := v_start + INTERVAL '8 hours';

    SELECT COUNT(*) FILTER (WHERE kind = 'meal'),
           COUNT(*) FILTER (WHERE kind = 'nap')
    INTO v_meals, v_naps
    FROM kms_daily_blocks
    WHERE group_id = p_group_id AND block_date = p_day;
    IF v_meals <> 3 OR v_naps <> 1 THEN
        RAISE EXCEPTION 'KMS_DAILY_ROUTINE_INCOMPLETE';
    END IF;
    IF EXISTS (
        SELECT 1 FROM kms_daily_blocks
        WHERE group_id = p_group_id AND block_date = p_day
          AND (start_time < v_start OR end_time > v_end)
    ) THEN
        RAISE EXCEPTION 'KMS_BLOCK_OUTSIDE_WORKDAY';
    END IF;
    IF EXISTS (
        SELECT 1 FROM schedule
        WHERE group_id = p_group_id
          AND (start_time AT TIME ZONE 'Europe/Kyiv')::date = p_day
          AND (start_time < v_start OR end_time > v_end)
    ) THEN
        RAISE EXCEPTION 'KMS_LESSON_OUTSIDE_WORKDAY';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION kms_publish_group_day(
    p_group_id BIGINT,
    p_day DATE,
    p_day_start TIME DEFAULT TIME '08:00'
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);
    PERFORM kms_validate_group_day(p_group_id, p_day, p_day_start);

    INSERT INTO kms_group_day_windows (group_id, block_date, day_start)
    VALUES (p_group_id, p_day, p_day_start)
    ON CONFLICT (group_id, block_date) DO UPDATE
    SET day_start = EXCLUDED.day_start;

    UPDATE schedule SET status = 'published'
    WHERE group_id = p_group_id
      AND (start_time AT TIME ZONE 'Europe/Kyiv')::date = p_day
      AND status = 'draft';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

CREATE FUNCTION kms_check_published_group_day(p_group_id BIGINT, p_day DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_day_start TIME;
BEGIN
    -- A day is protected while it contains at least one published lesson.
    -- Draft-only days may still be assembled incrementally.
    IF NOT EXISTS (
        SELECT 1 FROM schedule
        WHERE group_id = p_group_id AND status = 'published'
          AND (start_time AT TIME ZONE 'Europe/Kyiv')::date = p_day
    ) THEN
        RETURN;
    END IF;

    SELECT day_start INTO v_day_start
    FROM kms_group_day_windows
    WHERE group_id = p_group_id AND block_date = p_day;
    -- 0005 did not persist p_day_start. Never invent a window for old data.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_REPUBLISH_DAY_REQUIRED'
            USING HINT = 'Call kms_publish_group_day with the correct day_start before editing blocks.';
    END IF;
    PERFORM kms_validate_group_day(p_group_id, p_day, v_day_start);
END;
$$;

CREATE FUNCTION kms_published_routine_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Shares the existing publication/block-edit lock from 0005.
    PERFORM pg_advisory_xact_lock(2026, 1005);
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM kms_check_published_group_day(OLD.group_id, OLD.block_date);
    END IF;
    IF TG_OP = 'INSERT' THEN
        PERFORM kms_check_published_group_day(NEW.group_id, NEW.block_date);
    ELSIF TG_OP = 'UPDATE' AND
          (OLD.group_id, OLD.block_date) IS DISTINCT FROM
          (NEW.group_id, NEW.block_date) THEN
        PERFORM kms_check_published_group_day(NEW.group_id, NEW.block_date);
    END IF;
    RETURN NULL;
END;
$$;

-- AFTER sees the resulting state, not a hypothetical row-by-row count.
-- Default: validate at statement end. Explicit deferral allows atomic
-- delete/insert replacements, but the final transaction must be valid.
CREATE CONSTRAINT TRIGGER trg_kms_published_routine_guard
AFTER INSERT OR UPDATE OR DELETE ON kms_daily_blocks
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION kms_published_routine_guard();
