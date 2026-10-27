-- 0007: Tuition and discounts

-- Базова місячна вартість навчання

INSERT INTO tuition_rates (
    amount, currency, billing_period, valid_from
)
SELECT
    15000, 'UAH', 'monthly', DATE '2020-01-01'
WHERE NOT EXISTS (
    SELECT 1 FROM tuition_rates
    WHERE currency = 'UAH'
      AND billing_period = 'monthly'
      AND valid_from <= CURRENT_DATE
);


-- Дозволяємо лише передбачені ТЗ пільги.
-- Перед застосуванням потрібно перевірити,
-- чи немає вже записів, що суперечать правилу.

ALTER TABLE discounts
ADD CONSTRAINT kms_discount_policy
CHECK (
    type = 'percent'
    AND COALESCE(value, percentage) IN (10, 20, 30)
);


-- Чинний тариф навчання

CREATE OR REPLACE FUNCTION kms_get_tuition_rate(
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    IF p_date IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_TUITION_DATE';
    END IF;

    SELECT amount
    INTO v_rate
    FROM tuition_rates
    WHERE currency = 'UAH'
      AND billing_period = 'monthly'
      AND valid_from <= p_date
      AND (valid_to IS NULL OR valid_to >= p_date)
    ORDER BY valid_from DESC, id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_TUITION_RATE_NOT_FOUND';
    END IF;

    RETURN v_rate;
END;
$$;


-- Додати нову ставку навчання

CREATE OR REPLACE FUNCTION kms_set_tuition_rate(
    p_amount NUMERIC,
    p_valid_from DATE
)
RETURNS tuition_rates
LANGUAGE plpgsql
AS $$
DECLARE
    v_result tuition_rates%ROWTYPE;
BEGIN
    IF p_amount IS NULL OR p_amount < 0
       OR p_valid_from IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_TUITION_RATE';
    END IF;

    INSERT INTO tuition_rates (
        amount, currency, billing_period, valid_from
    )
    VALUES (
        p_amount, 'UAH', 'monthly', p_valid_from
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Призначити пільгу дитині

CREATE OR REPLACE FUNCTION kms_assign_child_discount(
    p_child_id BIGINT,
    p_discount_id BIGINT
)
RETURNS child_discounts
LANGUAGE plpgsql
AS $$
DECLARE
    v_result child_discounts%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1007);

    IF NOT EXISTS (
        SELECT 1 FROM children WHERE id = p_child_id
    ) THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM discounts
        WHERE id = p_discount_id
          AND is_active = TRUE
          AND valid_from <= CURRENT_DATE
          AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    ) THEN
        RAISE EXCEPTION 'KMS_DISCOUNT_NOT_AVAILABLE';
    END IF;

    UPDATE child_discounts
    SET revoked_at = now()
    WHERE child_id = p_child_id
      AND revoked_at IS NULL;

    INSERT INTO child_discounts (
        child_id, discount_id
    )
    VALUES (p_child_id, p_discount_id)
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Скасування пільги

CREATE OR REPLACE FUNCTION kms_revoke_child_discount(
    p_child_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(2026, 1007);

    UPDATE child_discounts
    SET revoked_at = now()
    WHERE child_id = p_child_id
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_ACTIVE_DISCOUNT_NOT_FOUND';
    END IF;
END;
$$;


-- Розрахунок навчання із пільгами.
-- p_months: 1 або 12.

CREATE OR REPLACE FUNCTION kms_calculate_tuition(
    p_child_id BIGINT,
    p_start_date DATE,
    p_months INTEGER DEFAULT 1
)
RETURNS TABLE (
    gross_amount NUMERIC,
    personal_discount NUMERIC,
    annual_discount NUMERIC,
    net_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate NUMERIC;
    v_discount NUMERIC := 0;
    v_gross NUMERIC;
    v_personal NUMERIC;
    v_annual NUMERIC;
BEGIN
    IF p_months IS NULL OR p_months NOT IN (1, 12)
       OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_BILLING_PERIOD';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM children WHERE id = p_child_id
    ) THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    v_rate := kms_get_tuition_rate(p_start_date);

    SELECT COALESCE(d.value, d.percentage, 0)
    INTO v_discount
    FROM child_discounts cd
    JOIN discounts d ON d.id = cd.discount_id
    WHERE cd.child_id = p_child_id
      AND cd.assigned_at::date <= p_start_date
      AND (
          cd.revoked_at IS NULL
          OR cd.revoked_at::date > p_start_date
      )
      AND d.valid_from <= p_start_date
      AND (d.valid_to IS NULL OR d.valid_to >= p_start_date)
    ORDER BY cd.assigned_at DESC
    LIMIT 1;

    v_discount := COALESCE(v_discount, 0);

    v_gross := ROUND(v_rate * p_months, 2);

    v_personal := ROUND(
        v_gross * v_discount / 100, 2
    );

    IF p_months = 12 THEN
        v_annual := ROUND(
            (v_gross - v_personal) * 0.12,
            2
        );
    ELSE
        v_annual := 0;
    END IF;

    RETURN QUERY SELECT
        v_gross,
        v_personal,
        v_annual,
        v_gross - v_personal - v_annual;
END;
$$;