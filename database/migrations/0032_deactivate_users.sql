-- Keep users and their immutable audit references permanently.
CREATE FUNCTION kms_deactivate_user(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_user users%ROWTYPE;
BEGIN
    SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF v_user.status = 'inactive' AND NOT v_user.is_active THEN
        RETURN TRUE;
    END IF;
    -- Existing admin protection and audit triggers remain enabled.
    UPDATE users SET status = 'inactive', is_active = FALSE WHERE id = p_user_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION kms_prevent_user_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'KMS_USER_DELETE_FORBIDDEN';
END;
$$;

-- Runs after trg_protect_single_admin, preserving its existing error contract.
CREATE TRIGGER trg_users_prevent_delete
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION kms_prevent_user_delete();
