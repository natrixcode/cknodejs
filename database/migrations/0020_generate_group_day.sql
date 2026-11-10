-- Issue #51. Working calendar-cycle decision: confirm with TL before merge.
-- Keep the lock shared with schedule/block guards and publication (0005).

CREATE FUNCTION kms_schedule_interval_conflict(
    p_group_id BIGINT, p_teacher_id BIGINT, p_room_id BIGINT,
    p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_exclude_id BIGINT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM kms_daily_blocks b
            WHERE b.group_id = p_group_id
              AND b.start_time < p_end AND b.end_time > p_start
        ) THEN 'KMS_LESSON_DAILY_BLOCK_CONFLICT'
        WHEN EXISTS (
            SELECT 1 FROM schedule s
            WHERE s.id IS DISTINCT FROM p_exclude_id AND s.group_id = p_group_id
              AND s.start_time < p_end AND s.end_time > p_start
        ) THEN 'KMS_SCHEDULE_GROUP_CONFLICT'
        WHEN EXISTS (
            SELECT 1 FROM schedule s
            WHERE s.id IS DISTINCT FROM p_exclude_id AND s.room_id = p_room_id
              AND s.start_time < p_end AND s.end_time > p_start
        ) THEN 'KMS_SCHEDULE_ROOM_CONFLICT'
        WHEN EXISTS (
            SELECT 1 FROM schedule s
            WHERE s.id IS DISTINCT FROM p_exclude_id AND s.teacher_id = p_teacher_id
              AND s.start_time < p_end AND s.end_time > p_start
        ) THEN 'KMS_SCHEDULE_TEACHER_CONFLICT'
    END;
$$;

-- Existing /validate contract: one proposed interval, optionally excluding
-- the draft being edited. Optional subject allows qualification validation.
CREATE FUNCTION kms_validate_lesson_draft(
    p_group_id BIGINT, p_teacher_id BIGINT, p_room_id BIGINT,
    p_start TIMESTAMPTZ, p_end TIMESTAMPTZ,
    p_exclude_id BIGINT DEFAULT NULL, p_subject_id BIGINT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_day DATE;
    v_day_start TIME;
    v_start TIMESTAMPTZ;
    v_conflict TEXT;
    v_subject BIGINT := p_subject_id;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);
    IF p_group_id IS NULL OR p_teacher_id IS NULL OR p_room_id IS NULL
       OR p_start IS NULL OR p_end IS NULL
       OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end <= p_start THEN
        RAISE EXCEPTION 'KMS_SCHEDULE_INVALID_INTERVAL';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND status = 'active') THEN
        RAISE EXCEPTION 'KMS_GROUP_NOT_ACTIVE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE id = p_room_id AND status IN ('available', 'occupied')) THEN
        RAISE EXCEPTION 'KMS_SCHEDULE_ROOM_UNAVAILABLE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_teacher_id AND position = 'teacher' AND status = 'active') THEN
        RAISE EXCEPTION 'KMS_GENERATION_NO_AVAILABLE_TEACHER';
    END IF;
    IF p_exclude_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM schedule WHERE id = p_exclude_id AND group_id = p_group_id AND status = 'draft') THEN
            RAISE EXCEPTION 'KMS_SCHEDULE_INVALID_EXCLUDE';
        END IF;
        SELECT COALESCE(v_subject, subject_id) INTO v_subject FROM schedule WHERE id = p_exclude_id;
    END IF;
    IF v_subject IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employee_subjects WHERE employee_id = p_teacher_id AND subject_id = v_subject
    ) THEN
        RAISE EXCEPTION 'KMS_TEACHER_SUBJECT_MISMATCH';
    END IF;
    v_day := (p_start AT TIME ZONE 'Europe/Kyiv')::date;
    SELECT COALESCE((SELECT day_start FROM kms_group_day_windows
        WHERE group_id = p_group_id AND block_date = v_day), TIME '08:00') INTO v_day_start;
    PERFORM kms_validate_group_day(p_group_id, v_day, v_day_start);
    v_start := (v_day + v_day_start) AT TIME ZONE 'Europe/Kyiv';
    IF p_start < v_start OR p_end > v_start + INTERVAL '8 hours'
       OR (p_end AT TIME ZONE 'Europe/Kyiv')::date <> v_day THEN
        RAISE EXCEPTION 'KMS_LESSON_OUTSIDE_WORKDAY';
    END IF;
    v_conflict := kms_schedule_interval_conflict(p_group_id, p_teacher_id, p_room_id, p_start, p_end, p_exclude_id);
    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = v_conflict, ERRCODE = 'P0001';
    END IF;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION kms_generate_group_day(p_group_id BIGINT, p_day DATE)
RETURNS SETOF schedule
LANGUAGE plpgsql
AS $$
DECLARE
    v_room BIGINT;
    v_day_start TIME;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_cursor TIMESTAMPTZ;
    v_subjects BIGINT[];
    v_chosen BIGINT[];
    v_teachers BIGINT[] := '{}';
    v_starts TIMESTAMPTZ[] := '{}';
    v_count INTEGER;
    v_offset INTEGER;
    v_subject BIGINT;
    v_teacher BIGINT;
    v_slot TIMESTAMPTZ;
    v_has_window BOOLEAN;
    v_has_room BOOLEAN;
    v_found BOOLEAN;
    v_row schedule;
    i INTEGER;
BEGIN
    -- VOLATILE function: queries after the lock see earlier committed runs.
    PERFORM pg_advisory_xact_lock(2026, 1005);
    IF p_group_id IS NULL OR p_day IS NULL OR NOT isfinite(p_day) THEN
        RAISE EXCEPTION 'KMS_GENERATION_INVALID_PARAMETERS';
    END IF;
    SELECT g.room_id INTO v_room FROM groups g
    WHERE g.id = p_group_id AND g.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_GROUP_NOT_ACTIVE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE id = v_room AND status IN ('available', 'occupied')) THEN
        RAISE EXCEPTION 'KMS_SCHEDULE_ROOM_UNAVAILABLE';
    END IF;
    IF EXISTS (
        SELECT 1 FROM schedule WHERE group_id = p_group_id
          AND start_time < ((p_day + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')
          AND end_time > (p_day::timestamp AT TIME ZONE 'Europe/Kyiv')
    ) THEN
        RAISE EXCEPTION 'KMS_GENERATION_DAY_EXISTS';
    END IF;
    SELECT COALESCE((SELECT day_start FROM kms_group_day_windows
        WHERE group_id = p_group_id AND block_date = p_day), TIME '08:00') INTO v_day_start;
    PERFORM kms_validate_group_day(p_group_id, p_day, v_day_start);
    v_start := (p_day + v_day_start) AT TIME ZONE 'Europe/Kyiv';
    v_end := v_start + INTERVAL '8 hours';
    v_cursor := v_start;

    SELECT array_agg(id ORDER BY id) INTO v_subjects FROM subjects;
    v_count := COALESCE(cardinality(v_subjects), 0);
    IF v_count < 3 THEN
        RAISE EXCEPTION 'KMS_GENERATION_INSUFFICIENT_SUBJECTS';
    END IF;
    -- bigint multiplication avoids overflow; normalize negative modulo.
    v_offset := (((p_day - DATE '2026-01-01')::bigint * 3 % v_count) + v_count) % v_count;
    v_chosen := ARRAY[v_subjects[v_offset + 1],
        v_subjects[(v_offset + 1) % v_count + 1],
        v_subjects[(v_offset + 2) % v_count + 1]];

    FOR i IN 1..3 LOOP
        v_subject := v_chosen[i];
        IF NOT EXISTS (
            SELECT 1 FROM employee_subjects es JOIN employees e ON e.id = es.employee_id
            WHERE es.subject_id = v_subject AND e.position = 'teacher' AND e.status = 'active'
        ) THEN
            RAISE EXCEPTION 'KMS_GENERATION_NO_AVAILABLE_TEACHER';
        END IF;
        v_has_window := FALSE;
        v_has_room := FALSE;
        v_found := FALSE;
        -- Earliest feasible start is the cursor or an obstacle's end.
        -- No arbitrary minute grid: also supports blocks at e.g. 08:07.
        -- Fixed subject order + equal durations: earliest finish leaves
        -- all later options available, so greedy placement is complete.
        FOR v_slot IN
            SELECT candidate FROM (
                SELECT v_cursor AS candidate
                UNION SELECT end_time FROM kms_daily_blocks WHERE group_id = p_group_id AND block_date = p_day
                UNION SELECT s.end_time FROM schedule s
                    WHERE s.start_time < v_end AND s.end_time > v_cursor
                      AND (s.room_id = v_room OR s.teacher_id IN (
                          SELECT employee_id FROM employee_subjects WHERE subject_id = v_subject
                      ))
            ) slots
            WHERE candidate >= v_cursor AND candidate + INTERVAL '30 minutes' <= v_end
              AND (candidate AT TIME ZONE 'Europe/Kyiv')::date = p_day
              AND ((candidate + INTERVAL '30 minutes') AT TIME ZONE 'Europe/Kyiv')::date = p_day
            ORDER BY candidate
        LOOP
            IF EXISTS (SELECT 1 FROM kms_daily_blocks WHERE group_id = p_group_id
                AND start_time < v_slot + INTERVAL '30 minutes' AND end_time > v_slot) THEN
                CONTINUE;
            END IF;
            v_has_window := TRUE;
            IF kms_schedule_interval_conflict(p_group_id, NULL, v_room, v_slot, v_slot + INTERVAL '30 minutes') IS NOT NULL THEN
                CONTINUE;
            END IF;
            v_has_room := TRUE;
            SELECT e.id INTO v_teacher
            FROM employees e JOIN employee_subjects es ON es.employee_id = e.id
            WHERE es.subject_id = v_subject AND e.position = 'teacher' AND e.status = 'active'
              AND kms_schedule_interval_conflict(p_group_id, e.id, v_room, v_slot, v_slot + INTERVAL '30 minutes') IS NULL
            ORDER BY e.id LIMIT 1;
            IF FOUND THEN
                v_teachers := array_append(v_teachers, v_teacher);
                v_starts := array_append(v_starts, v_slot);
                v_cursor := v_slot + INTERVAL '30 minutes';
                v_found := TRUE;
                EXIT;
            END IF;
        END LOOP;
        IF NOT v_found THEN
            IF NOT v_has_window THEN
                RAISE EXCEPTION 'KMS_GENERATION_NO_FREE_WINDOW';
            ELSIF NOT v_has_room THEN
                RAISE EXCEPTION 'KMS_GENERATION_ROOM_CONFLICT';
            ELSE
                RAISE EXCEPTION 'KMS_GENERATION_NO_AVAILABLE_TEACHER';
            END IF;
        END IF;
    END LOOP;

    -- Persist only a complete plan; any trigger failure rolls back all rows.
    FOR i IN 1..3 LOOP
        SELECT * INTO v_row FROM kms_create_lesson(p_group_id, v_chosen[i], v_teachers[i],
            v_room, v_starts[i], v_starts[i] + INTERVAL '30 minutes');
        RETURN NEXT v_row;
    END LOOP;
END;
$$;
