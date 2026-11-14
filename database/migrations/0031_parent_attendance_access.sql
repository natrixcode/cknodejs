
CREATE FUNCTION kms_parent_child_attendance(
    p_user_id BIGINT,
    p_child_id BIGINT,
    p_from DATE DEFAULT NULL,
    p_to DATE DEFAULT NULL
)
RETURNS TABLE (
    attendance_date DATE,
    present BOOLEAN,
    reason TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    -- Перевірка коректності дат
    IF p_from IS NOT NULL
       AND p_to IS NOT NULL
       AND p_from > p_to THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_INVALID_PARAMETERS';
    END IF;

    -- Перевірка доступу до дитини
    IF NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = p_user_id
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
          )
    ) THEN
        RAISE EXCEPTION 'KMS_ATTENDANCE_FORBIDDEN';
    END IF;

    RETURN QUERY
    SELECT
        a.attendance_date,
        a.present,
        a.reason
    FROM attendance a
    WHERE a.child_id = p_child_id
      AND (p_from IS NULL OR a.attendance_date >= p_from)
      AND (p_to IS NULL OR a.attendance_date <= p_to)
    ORDER BY a.attendance_date DESC;
END;
$$;
