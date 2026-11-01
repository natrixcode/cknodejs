-- Prevent changes to already published lessons.
-- Business rule enforced directly in PostgreSQL.

CREATE OR REPLACE FUNCTION kms_protect_published_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'KMS_PUBLISHED_SCHEDULE_IMMUTABLE'
                USING ERRCODE = '23514';
        END IF;

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
        RAISE EXCEPTION 'KMS_PUBLISHED_SCHEDULE_IMMUTABLE'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kms_protect_published_schedule
BEFORE UPDATE OR DELETE
ON schedule
FOR EACH ROW
EXECUTE FUNCTION kms_protect_published_schedule();