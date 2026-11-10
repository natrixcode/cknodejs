UPDATE users
SET role = 'employee'
WHERE role = 'teacher';

CREATE OR REPLACE FUNCTION kms_validate_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.role NOT IN (
            'admin',
            'manager',
            'parent',
            'employee'
        ) THEN
            RAISE EXCEPTION 'KMS_INVALID_USER_ROLE'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           AND NEW.role NOT IN (
               'admin',
               'manager',
               'parent',
               'employee'
           ) THEN
            RAISE EXCEPTION 'KMS_INVALID_USER_ROLE'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_user_role
BEFORE INSERT OR UPDATE OF role ON users
FOR EACH ROW
EXECUTE FUNCTION kms_validate_user_role();
