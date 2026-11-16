-- 0033: Schedule list filtered by teacher and room, with access control (#73).
--
-- BA decisions:
--   1. GET /api/v1/schedule supports teacher_id and room_id filters.
--   2. A teacher (employee with position 'teacher') sees only own lessons;
--      an educator sees only lessons of own group.
--   3. A teacher requesting another teacher's schedule gets 403.
--   4. Admin and manager may filter by any teacher and any room.
--
-- Visibility rules match kms_can_view_schedule (0017), so the list and
-- GET /schedule/:id never disagree about who sees a lesson.

CREATE OR REPLACE FUNCTION kms_list_schedule(
    p_user_id BIGINT,
    p_teacher_id BIGINT DEFAULT NULL,
    p_room_id BIGINT DEFAULT NULL
)
RETURNS SETOF schedule
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_role TEXT;
    v_employee_id BIGINT;
    v_position TEXT;
BEGIN
    SELECT u.role, u.employee_id, e.position
    INTO v_role, v_employee_id, v_position
    FROM users u
    LEFT JOIN employees e
      ON e.id = u.employee_id
     AND e.status = 'active'
    WHERE u.id = p_user_id
      AND u.status = 'active'
      AND u.is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_SCHEDULE_FORBIDDEN';
    END IF;

    -- Admin and manager: any teacher, any room.
    IF v_role IN ('admin', 'manager') THEN
        RETURN QUERY
        SELECT s.*
        FROM schedule s
        WHERE (p_teacher_id IS NULL OR s.teacher_id = p_teacher_id)
          AND (p_room_id IS NULL OR s.room_id = p_room_id)
        ORDER BY s.start_time, s.id;
        RETURN;
    END IF;

    -- Teacher: own lessons only; another teacher's schedule is forbidden.
    IF v_role = 'employee' AND v_position = 'teacher' THEN
        IF p_teacher_id IS NOT NULL
           AND p_teacher_id IS DISTINCT FROM v_employee_id THEN
            RAISE EXCEPTION 'KMS_SCHEDULE_FORBIDDEN';
        END IF;

        RETURN QUERY
        SELECT s.*
        FROM schedule s
        WHERE s.teacher_id = v_employee_id
          AND (p_room_id IS NULL OR s.room_id = p_room_id)
        ORDER BY s.start_time, s.id;
        RETURN;
    END IF;

    -- Educator: lessons of own group; filters narrow within that group.
    IF v_role = 'employee' AND v_position = 'educator' THEN
        RETURN QUERY
        SELECT s.*
        FROM schedule s
        WHERE EXISTS (
                SELECT 1
                FROM group_staff gs
                WHERE gs.employee_id = v_employee_id
                  AND gs.role = 'educator'
                  AND gs.group_id = s.group_id
              )
          AND (p_teacher_id IS NULL OR s.teacher_id = p_teacher_id)
          AND (p_room_id IS NULL OR s.room_id = p_room_id)
        ORDER BY s.start_time, s.id;
        RETURN;
    END IF;

    -- Assistant, parent and any other role: no access to the list.
    RAISE EXCEPTION 'KMS_SCHEDULE_FORBIDDEN';
END;
$$;
