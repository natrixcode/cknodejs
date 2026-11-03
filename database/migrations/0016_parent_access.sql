CREATE OR REPLACE FUNCTION kms_can_access_parent(
    p_user_id BIGINT,
    p_parent_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role IN ('admin', 'manager')
              OR (
                  u.role = 'parent'
                  AND u.parent_id = p_parent_id
              )
          )
    );
$$;