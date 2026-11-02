
CREATE OR REPLACE FUNCTION kms_can_view_schedule(
    p_user_id BIGINT,
    p_schedule_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN schedule s ON s.id = p_schedule_id
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              -- Admin and Manager can view all schedules
              u.role IN ('admin', 'manager')

              -- Employee with teacher position can view assigned lessons
              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM employees e
                      WHERE e.id = u.employee_id
                        AND e.position = 'teacher'
                        AND e.status = 'active'
                        AND s.teacher_id = e.id
                  )
              )

              -- Educator can view own group's schedule
              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM employees e
                      JOIN group_staff gs
                        ON gs.employee_id = e.id
                      WHERE e.id = u.employee_id
                        AND e.position = 'educator'
                        AND e.status = 'active'
                        AND gs.role = 'educator'
                        AND gs.group_id = s.group_id
                  )
              )

              -- Parent can view own child's published schedule
              OR (
                  u.role = 'parent'
                  AND s.status = 'published'
                  AND EXISTS (
                      SELECT 1
                      FROM children_parents cp
                      JOIN children c ON c.id = cp.child_id
                      WHERE cp.parent_id = u.parent_id
                        AND c.group_id = s.group_id
                  )
              )
          )
    );
$$;
