-- Protect published group days when schedule rows change.
-- Preserve the 8-hour window defined in migration 0012.

CREATE OR REPLACE FUNCTION kms_published_schedule_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_day DATE;
    v_new_day DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1005);

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old_day :=
            (OLD.start_time AT TIME ZONE 'Europe/Kyiv')::date;

        PERFORM kms_check_published_group_day(
            OLD.group_id,
            v_old_day
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_day :=
            (NEW.start_time AT TIME ZONE 'Europe/Kyiv')::date;

        IF TG_OP = 'INSERT'
           OR OLD.group_id IS DISTINCT FROM NEW.group_id
           OR v_old_day IS DISTINCT FROM v_new_day
           OR OLD.status IS DISTINCT FROM NEW.status
           OR OLD.start_time IS DISTINCT FROM NEW.start_time
           OR OLD.end_time IS DISTINCT FROM NEW.end_time
        THEN
            PERFORM kms_check_published_group_day(
                NEW.group_id,
                v_new_day
            );
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_kms_published_schedule_guard
AFTER INSERT OR UPDATE OR DELETE
ON schedule
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION kms_published_schedule_guard();
