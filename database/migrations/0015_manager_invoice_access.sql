CREATE OR REPLACE FUNCTION kms_can_view_invoice(
    p_user_id BIGINT,
    p_invoice_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM invoices i
        JOIN users u ON u.id = p_user_id
        WHERE i.id = p_invoice_id
          AND u.status = 'active'
          AND u.is_active = TRUE
          AND (
              u.role IN ('admin', 'manager')
              OR (
                  u.role = 'parent'
                  AND kms_can_view_child(u.id, i.child_id)
              )
          )
    );
$$;