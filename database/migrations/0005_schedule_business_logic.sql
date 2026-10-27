-- 0005: Schedule and daily routine

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Заборона накладань опублікованого розкладу

ALTER TABLE schedule
ADD CONSTRAINT kms_teacher_no_overlap
EXCLUDE USING gist (
    teacher_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status = 'published');

ALTER TABLE schedule
ADD CONSTRAINT kms_group_no_overlap
EXCLUDE USING gist (
    group_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status = 'published');

ALTER TABLE schedule
ADD CONSTRAINT kms_room_no_overlap
EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status = 'published');


-- Сон та прийоми їжі

CREATE TABLE kms_daily_blocks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES groups(id),
    block_date DATE NOT NULL,
    kind VARCHAR(10) NOT NULL
        CHECK (kind IN ('meal', 'nap')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    CHECK (end_time > start_time),
    CHECK (
        (kind = 'meal'
         AND end_time - start_time = INTERVAL '30 minutes')
        OR
        (kind = 'nap'
         AND end_time - start_time = INTERVAL '60 minutes')
    ),
    CHECK (
        (start_time AT TIME ZONE 'Europe/Kyiv')::date
            = block_date
        AND
        (end_time AT TIME ZONE 'Europe/Kyiv')::date
            = block_date
    ),
    EXCLUDE USING gist (
        group_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    )
);


-- Перевірка режиму дня

CREATE OR REPLACE FUNCTION kms_daily_block_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    -- Не допускаємо накладання на
    -- вже опубліковані заняття
    IF EXISTS (
        SELECT 1
        FROM schedule s
        WHERE s.group_id = NEW.group_id
          AND s.status = 'published'
          AND s.start_time < NEW.end_time
          AND s.end_time > NEW.start_time
    ) THEN
        RAISE EXCEPTION 'KMS_BLOCK_LESSON_CONFLICT';
    END IF;

    -- Прийоми їжі не можуть бути підряд
    IF NEW.kind = 'meal' AND EXISTS (
        SELECT 1
        FROM kms_daily_blocks b
        WHERE b.group_id = NEW.group_id
          AND b.block_date = NEW.block_date
          AND b.kind = 'meal'
          AND b.id IS DISTINCT FROM NEW.id
          AND (
              b.end_time = NEW.start_time
              OR b.start_time = NEW.end_time
          )
    ) THEN
        RAISE EXCEPTION 'KMS_CONSECUTIVE_MEALS';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kms_daily_block_guard
BEFORE INSERT OR UPDATE OR DELETE
ON kms_daily_blocks
FOR EACH ROW
EXECUTE FUNCTION kms_daily_block_guard();


-- Перевірка заняття

CREATE OR REPLACE FUNCTION kms_schedule_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_position VARCHAR;
    v_employee_status VARCHAR;
    v_group_status VARCHAR;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);

    SELECT position, status
    INTO v_position, v_employee_status
    FROM employees
    WHERE id = NEW.teacher_id;

    IF v_position IS DISTINCT FROM 'teacher'
       OR v_employee_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'KMS_INVALID_TEACHER';
    END IF;

    -- Викладач повинен бути призначений
    -- на відповідну дисципліну
    IF NEW.subject_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM employee_subjects es
           WHERE es.employee_id = NEW.teacher_id
             AND es.subject_id = NEW.subject_id
       ) THEN
        RAISE EXCEPTION 'KMS_TEACHER_SUBJECT_MISMATCH';
    END IF;

    IF NEW.status = 'published' THEN

        SELECT status INTO v_group_status
        FROM groups WHERE id = NEW.group_id;

        IF v_group_status IS DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'KMS_GROUP_NOT_ACTIVE';
        END IF;

        IF NEW.subject_id IS NULL THEN
            RAISE EXCEPTION 'KMS_SUBJECT_REQUIRED';
        END IF;

        IF EXISTS (
            SELECT 1 FROM kms_daily_blocks b
            WHERE b.group_id = NEW.group_id
              AND b.start_time < NEW.end_time
              AND b.end_time > NEW.start_time
        ) THEN
            RAISE EXCEPTION 'KMS_LESSON_DAILY_BLOCK_CONFLICT';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kms_schedule_guard
BEFORE INSERT OR UPDATE
ON schedule
FOR EACH ROW
EXECUTE FUNCTION kms_schedule_guard();


-- Створити заняття у статусі draft

CREATE OR REPLACE FUNCTION kms_create_lesson(
    p_group_id BIGINT,
    p_subject_id BIGINT,
    p_teacher_id BIGINT,
    p_room_id BIGINT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ
)
RETURNS schedule
LANGUAGE plpgsql
AS $$
DECLARE
    v_result schedule%ROWTYPE;
BEGIN
    INSERT INTO schedule (
        group_id, subject_id, teacher_id,
        room_id, start_time, end_time, status
    )
    VALUES (
        p_group_id, p_subject_id, p_teacher_id,
        p_room_id, p_start, p_end, 'draft'
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Публікація занять однієї групи за день
-- з перевіркою 8-годинного режиму

CREATE OR REPLACE FUNCTION kms_publish_group_day(
    p_group_id BIGINT,
    p_day DATE,
    p_day_start TIME DEFAULT TIME '08:00'
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_meals INTEGER;
    v_naps INTEGER;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_updated INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);

    v_start := (p_day + p_day_start)
        AT TIME ZONE 'Europe/Kyiv';
    v_end := v_start + INTERVAL '8 hours';

    SELECT
        COUNT(*) FILTER (WHERE kind = 'meal'),
        COUNT(*) FILTER (WHERE kind = 'nap')
    INTO v_meals, v_naps
    FROM kms_daily_blocks
    WHERE group_id = p_group_id
      AND block_date = p_day;

    IF v_meals <> 3 OR v_naps <> 1 THEN
        RAISE EXCEPTION 'KMS_DAILY_ROUTINE_INCOMPLETE';
    END IF;

    IF EXISTS (
        SELECT 1 FROM kms_daily_blocks b
        WHERE b.group_id = p_group_id
          AND b.block_date = p_day
          AND (b.start_time < v_start
               OR b.end_time > v_end)
    ) THEN
        RAISE EXCEPTION 'KMS_BLOCK_OUTSIDE_WORKDAY';
    END IF;

    IF EXISTS (
        SELECT 1 FROM schedule s
        WHERE s.group_id = p_group_id
          AND (s.start_time AT TIME ZONE 'Europe/Kyiv')::date = p_day
          AND (s.start_time < v_start
               OR s.end_time > v_end)
    ) THEN
        RAISE EXCEPTION 'KMS_LESSON_OUTSIDE_WORKDAY';
    END IF;

    UPDATE schedule
    SET status = 'published'
    WHERE group_id = p_group_id
      AND (start_time AT TIME ZONE 'Europe/Kyiv')::date = p_day
      AND status = 'draft';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;


-- Перевірити, чи групи одного віку
-- отримали однакову кількість занять

CREATE OR REPLACE FUNCTION kms_check_age_schedule_balance(
    p_day DATE,
    p_age INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    WITH lesson_counts AS (
        SELECT
            g.id,
            COUNT(s.id) AS lesson_count
        FROM groups g
        LEFT JOIN schedule s
            ON s.group_id = g.id
           AND s.status = 'published'
           AND (s.start_time AT TIME ZONE 'Europe/Kyiv')::date
               = p_day
        WHERE g.age_years = p_age
          AND g.status = 'active'
        GROUP BY g.id
    )
    SELECT COALESCE(
        MAX(lesson_count) = MIN(lesson_count),
        TRUE
    )
    FROM lesson_counts;
$$;