CREATE OR REPLACE FUNCTION kms_can_employee_access_api(
    p_user_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN employees e
          ON e.id = u.employee_id
        WHERE u.id = p_user_id
          AND u.role = 'employee'
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND e.status = 'active'
          AND e.position IN ('educator', 'teacher')
    );
$$;
