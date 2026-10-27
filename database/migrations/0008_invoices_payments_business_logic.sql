-- 0008: Invoices and payments

-- Не дозволяємо два чинні рахунки
-- за періоди, що перетинаються, для однієї дитини.
-- Потрібне btree_gist із міграції 0005.

ALTER TABLE invoices
ADD CONSTRAINT kms_invoice_no_overlap
EXCLUDE USING gist (
    child_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
) WHERE (status <> 'cancelled');


-- Захист рахунка від некоректних змін

CREATE OR REPLACE FUNCTION kms_invoice_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_paid NUMERIC;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('draft', 'issued') THEN
            RAISE EXCEPTION 'KMS_INVALID_INITIAL_INVOICE_STATUS';
        END IF;
        RETURN NEW;
    END IF;

    -- Виставлений рахунок не можна перерахувати.
    IF OLD.status IN ('issued', 'paid')
       AND (
           NEW.tuition_amount IS DISTINCT FROM OLD.tuition_amount
           OR NEW.meal_amount IS DISTINCT FROM OLD.meal_amount
           OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.child_id IS DISTINCT FROM OLD.child_id
           OR NEW.period_start IS DISTINCT FROM OLD.period_start
           OR NEW.period_end IS DISTINCT FROM OLD.period_end
           OR NEW.parameters IS DISTINCT FROM OLD.parameters
       ) THEN
        RAISE EXCEPTION 'KMS_ISSUED_INVOICE_IMMUTABLE';
    END IF;

    IF OLD.status IN ('paid', 'cancelled')
       AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'KMS_FINAL_INVOICE_IMMUTABLE';
    END IF;

    IF OLD.status = 'draft'
       AND NEW.status NOT IN ('draft', 'issued', 'cancelled') THEN
        RAISE EXCEPTION 'KMS_INVALID_INVOICE_TRANSITION';
    END IF;

    IF OLD.status = 'issued'
       AND NEW.status NOT IN ('issued', 'paid', 'cancelled') THEN
        RAISE EXCEPTION 'KMS_INVALID_INVOICE_TRANSITION';
    END IF;

    IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
        SELECT COALESCE(SUM(amount), 0)
        INTO v_paid
        FROM payments
        WHERE invoice_id = OLD.id;

        IF v_paid <> OLD.total_amount THEN
            RAISE EXCEPTION 'KMS_INVOICE_NOT_FULLY_PAID';
        END IF;
    END IF;

    IF NEW.status = 'cancelled'
       AND EXISTS (
           SELECT 1 FROM payments
           WHERE invoice_id = OLD.id
       ) THEN
        RAISE EXCEPTION 'KMS_INVOICE_HAS_PAYMENTS';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kms_invoice_guard
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION kms_invoice_guard();


-- Створити та виставити рахунок

CREATE OR REPLACE FUNCTION kms_issue_invoice(
    p_child_id BIGINT,
    p_start_date DATE,
    p_months INTEGER,
    p_meal_days INTEGER
)
RETURNS invoices
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
    v_end_date DATE;
    v_tuition RECORD;
    v_meal NUMERIC;
    v_result invoices%ROWTYPE;
BEGIN
    IF p_start_date IS NULL
       OR EXTRACT(DAY FROM p_start_date) <> 1
       OR p_months IS NULL OR p_months NOT IN (1, 12)
       OR p_meal_days IS NULL
       OR p_meal_days < 0
       OR (p_months = 1 AND p_meal_days > 31)
       OR (p_months = 12 AND p_meal_days > 366)
    THEN
        RAISE EXCEPTION 'KMS_INVALID_INVOICE_PERIOD';
    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1008);

    SELECT * INTO v_child
    FROM children WHERE id = p_child_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    SELECT * INTO v_tuition
    FROM kms_calculate_tuition(
        p_child_id, p_start_date, p_months
    );

    v_meal := kms_calculate_child_meal(
        p_child_id, p_meal_days, p_start_date
    );

    v_end_date := (
        p_start_date
        + make_interval(months => p_months)
        - INTERVAL '1 day'
    )::DATE;

    INSERT INTO invoices (
        child_id,
        period_start,
        period_end,
        currency,
        tuition_amount,
        meal_amount,
        discount_amount,
        parameters,
        status
    )
    VALUES (
        p_child_id,
        p_start_date,
        v_end_date,
        'UAH',
        v_tuition.gross_amount,
        v_meal,
        v_tuition.personal_discount
            + v_tuition.annual_discount,
        jsonb_build_object(
            'months', p_months,
            'meal_days', p_meal_days,
            'group_id', v_child.group_id,
            'personal_discount',
                v_tuition.personal_discount,
            'annual_discount',
                v_tuition.annual_discount
        ),
        'issued'
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Захист реєстрації платежів

CREATE OR REPLACE FUNCTION kms_payment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice invoices%ROWTYPE;
    v_paid NUMERIC;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'KMS_PAYMENT_IMMUTABLE';
    END IF;

    SELECT * INTO v_invoice
    FROM invoices
    WHERE id = NEW.invoice_id
    FOR UPDATE;

    IF NOT FOUND OR v_invoice.status <> 'issued' THEN
        RAISE EXCEPTION 'KMS_INVOICE_NOT_PAYABLE';
    END IF;

    IF NEW.currency <> v_invoice.currency THEN
        RAISE EXCEPTION 'KMS_PAYMENT_CURRENCY_MISMATCH';
    END IF;

    IF NEW.transaction_id IS NULL
       OR btrim(NEW.transaction_id) = '' THEN
        RAISE EXCEPTION 'KMS_TRANSACTION_ID_REQUIRED';
    END IF;

    IF NEW.amount <= 0
       OR NEW.amount <> ROUND(NEW.amount, 2) THEN
        RAISE EXCEPTION 'KMS_INVALID_PAYMENT_AMOUNT';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM payments
    WHERE invoice_id = NEW.invoice_id;

    IF v_paid + NEW.amount > v_invoice.total_amount THEN
        RAISE EXCEPTION 'KMS_PAYMENT_EXCEEDS_BALANCE';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kms_payment_guard
BEFORE INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION kms_payment_guard();


-- Реєстрація платежу

CREATE OR REPLACE FUNCTION kms_register_payment(
    p_invoice_id BIGINT,
    p_amount NUMERIC,
    p_method VARCHAR,
    p_transaction_id VARCHAR,
    p_payment_date TIMESTAMPTZ DEFAULT now()
)
RETURNS payments
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice invoices%ROWTYPE;
    v_result payments%ROWTYPE;
    v_paid NUMERIC;
BEGIN
    IF p_transaction_id IS NULL
       OR btrim(p_transaction_id) = '' THEN
        RAISE EXCEPTION 'KMS_TRANSACTION_ID_REQUIRED';
    END IF;

    -- Блокуємо рахунок на весь час проведення.
    SELECT * INTO v_invoice
    FROM invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_INVOICE_NOT_FOUND';
    END IF;

    -- Повторний ідентичний запит
    -- повертає вже створений платіж.
    SELECT * INTO v_result
    FROM payments
    WHERE transaction_id = p_transaction_id;

    IF FOUND THEN
        IF v_result.invoice_id = p_invoice_id
           AND v_result.amount = p_amount
           AND v_result.method = p_method THEN
            RETURN v_result;
        END IF;

        RAISE EXCEPTION 'KMS_TRANSACTION_ID_CONFLICT';
    END IF;

    INSERT INTO payments (
        invoice_id, amount, method,
        transaction_id, payment_date, currency
    )
    VALUES (
        p_invoice_id, p_amount, p_method,
        p_transaction_id, p_payment_date,
        v_invoice.currency
    )
    RETURNING * INTO v_result;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM payments
    WHERE invoice_id = p_invoice_id;

    IF v_paid = v_invoice.total_amount THEN
        UPDATE invoices
        SET status = 'paid'
        WHERE id = p_invoice_id;
    END IF;

    RETURN v_result;
END;
$$;


-- Залишок боргу за рахунком

CREATE OR REPLACE FUNCTION kms_invoice_balance(
    p_invoice_id BIGINT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    SELECT i.total_amount - COALESCE(SUM(p.amount), 0)
    INTO v_balance
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id
    WHERE i.id = p_invoice_id
    GROUP BY i.id, i.total_amount;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_INVOICE_NOT_FOUND';
    END IF;

    RETURN v_balance;
END;
$$;


-- Скасування неоплаченого рахунка

CREATE OR REPLACE FUNCTION kms_cancel_invoice(
    p_invoice_id BIGINT
)
RETURNS invoices
LANGUAGE plpgsql
AS $$
DECLARE
    v_result invoices%ROWTYPE;
BEGIN
    UPDATE invoices
    SET status = 'cancelled'
    WHERE id = p_invoice_id
      AND status IN ('draft', 'issued')
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_INVOICE_CANNOT_BE_CANCELLED';
    END IF;

    RETURN v_result;
END;
$$;