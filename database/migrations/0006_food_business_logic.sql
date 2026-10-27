-- 0006: Food and meal tariffs

-- Початкові тарифи.
-- Старіші дати дозволяють робити
-- розрахунки за історичні періоди.

INSERT INTO meal_prices (
    age_years, price_per_day, valid_from
)
VALUES
    (2, 300, DATE '2020-01-01'),
    (3, 400, DATE '2020-01-01'),
    (4, 500, DATE '2020-01-01'),
    (5, 600, DATE '2020-01-01')
ON CONFLICT (age_years, valid_from) DO NOTHING;


-- Знайти чинний тариф за віком і датою

CREATE OR REPLACE FUNCTION kms_get_meal_rate(
    p_age INTEGER,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    IF p_age IS NULL OR p_age NOT BETWEEN 2 AND 5
       OR p_date IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_MEAL_PARAMETERS';
    END IF;

    SELECT price_per_day
    INTO v_rate
    FROM meal_prices
    WHERE age_years = p_age
      AND valid_from <= p_date
    ORDER BY valid_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_MEAL_RATE_NOT_FOUND';
    END IF;

    RETURN v_rate;
END;
$$;


-- Розрахунок вартості харчування

CREATE OR REPLACE FUNCTION kms_calculate_meal_cost(
    p_age INTEGER,
    p_days INTEGER,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_days IS NULL OR p_days NOT BETWEEN 0 AND 366 THEN
        RAISE EXCEPTION 'KMS_INVALID_MEAL_DAYS';
    END IF;

    RETURN ROUND(
        kms_get_meal_rate(p_age, p_date) * p_days,
        2
    );
END;
$$;


-- Розрахувати харчування конкретної дитини

CREATE OR REPLACE FUNCTION kms_calculate_child_meal(
    p_child_id BIGINT,
    p_days INTEGER,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_birth_date DATE;
    v_age INTEGER;
BEGIN
    SELECT date_of_birth
    INTO v_birth_date
    FROM children
    WHERE id = p_child_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
    END IF;

    v_age := calculate_child_age(v_birth_date, p_date);

    RETURN kms_calculate_meal_cost(
        v_age, p_days, p_date
    );
END;
$$;


-- Додати новий тариф з дати початку дії

CREATE OR REPLACE FUNCTION kms_set_meal_rate(
    p_age INTEGER,
    p_price NUMERIC,
    p_valid_from DATE
)
RETURNS meal_prices
LANGUAGE plpgsql
AS $$
DECLARE
    v_result meal_prices%ROWTYPE;
BEGIN
    IF p_age IS NULL OR p_age NOT BETWEEN 2 AND 5
       OR p_price IS NULL OR p_price < 0
       OR p_valid_from IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_MEAL_RATE';
    END IF;

    INSERT INTO meal_prices (
        age_years, price_per_day, valid_from
    )
    VALUES (
        p_age, p_price, p_valid_from
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;