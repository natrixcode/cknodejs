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
        JOIN children c ON c.id = p_child_id
        WHERE u.id = p_user_id
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
                        AND cp.child_id = c.id
                  )
              )

              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM employees e
                      JOIN group_staff gs
                        ON gs.employee_id = e.id
                      WHERE e.id = u.employee_id
                        AND e.status = 'active'
                        AND e.position = 'educator'
                        AND gs.role = 'educator'
                        AND gs.group_id = c.group_id
                  )
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION kms_can_view_group_children(
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
        JOIN groups g ON g.id = p_group_id
        WHERE u.id = p_user_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role IN ('admin', 'manager')

              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM employees e
                      JOIN group_staff gs
                        ON gs.employee_id = e.id
                      WHERE e.id = u.employee_id
                        AND e.status = 'active'
                        AND e.position = 'educator'
                        AND gs.role = 'educator'
                        AND gs.group_id = g.id
                  )
              )

              OR (
                  u.role = 'employee'
                  AND EXISTS (
                      SELECT 1
                      FROM employees e
                      JOIN schedule s
                        ON s.teacher_id = e.id
                      WHERE e.id = u.employee_id
                        AND e.status = 'active'
                        AND e.position = 'teacher'
                        AND s.group_id = g.id
                  )
              )
          )
    );
$$;

CREATE UNIQUE INDEX users_single_admin_idx
ON users (role)
WHERE role = 'admin';

CREATE OR REPLACE FUNCTION kms_protect_single_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'admin' THEN
            RAISE EXCEPTION 'KMS_ADMIN_IMMUTABLE'
                USING ERRCODE = '23505';
        END IF;

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.role = 'admin'
           AND (
               NEW.role IS DISTINCT FROM OLD.role
               OR NEW.status IS DISTINCT FROM OLD.status
               OR NEW.is_active IS DISTINCT FROM OLD.is_active
           )
        THEN
            RAISE EXCEPTION 'KMS_ADMIN_IMMUTABLE'
                USING ERRCODE = '23505';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_single_admin
BEFORE UPDATE OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION kms_protect_single_admin();
