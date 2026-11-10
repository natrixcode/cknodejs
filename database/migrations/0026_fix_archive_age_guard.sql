-- 0026: Archiving a child must not depend on the child's age.
-- Issue #52. Fix for 0022: a child aged 6+ (leaving for school)
-- could not be archived because kms_children_guard ran the
-- 2-5 age check on every status update.
-- 0022 is already applied, so the fix is a new migration.

CREATE OR REPLACE FUNCTION kms_children_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_age INTEGER;
    v_excluded_child_id BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1001);

    IF NEW.status = 'archived' AND NEW.group_id IS NOT NULL THEN
        RAISE EXCEPTION 'KMS_CANNOT_ASSIGN_ARCHIVED_CHILD';
    END IF;

    -- An archived child has no group, so age and group
    -- capacity rules do not apply to it.
    IF NEW.status = 'archived' THEN
        RETURN NEW;
    END IF;

    v_age := calculate_child_age(
        NEW.date_of_birth
    );

    IF v_age IS NULL
       OR v_age NOT BETWEEN 2 AND 5 THEN
        RAISE EXCEPTION 'KMS_CHILD_AGE_OUT_OF_RANGE';
    END IF;

    IF NEW.group_id IS NOT NULL THEN
        v_excluded_child_id := NULL;

        IF TG_OP = 'UPDATE' THEN
            v_excluded_child_id := OLD.id;
        END IF;

        PERFORM validate_group_assignment(
            NEW.date_of_birth,
            NEW.group_id,
            v_excluded_child_id
        );
    END IF;

    RETURN NEW;
END;
$$;
