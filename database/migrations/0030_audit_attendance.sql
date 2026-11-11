-- 0030: Attendance changes must be recorded in the audit log (#55).
-- 0021 created the table before kms_audit_row existed in its final form,
-- and 0025 did not include attendance in its list of audited tables.

DROP TRIGGER IF EXISTS trg_kms_audit ON attendance;
CREATE TRIGGER trg_kms_audit
AFTER INSERT OR UPDATE OR DELETE
ON attendance
FOR EACH ROW
EXECUTE FUNCTION kms_audit_row();

DROP TRIGGER IF EXISTS trg_kms_prevent_truncate ON attendance;
CREATE TRIGGER trg_kms_prevent_truncate
BEFORE TRUNCATE ON attendance
FOR EACH STATEMENT
EXECUTE FUNCTION kms_prevent_truncate();
