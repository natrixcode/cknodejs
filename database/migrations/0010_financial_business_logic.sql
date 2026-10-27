-- 0010: Financial reporting and forecasting

-- Загальний фінансовий звіт

CREATE OR REPLACE FUNCTION kms_financial_report(
    p_start DATE,
    p_end DATE,
    p_basis VARCHAR DEFAULT 'accrual'
)
RETURNS TABLE (
    revenue NUMERIC,
    payroll_cost NUMERIC,
    other_expenses NUMERIC,
    operating_profit NUMERIC,
    room_model_cost NUMERIC,
    modeled_profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_revenue NUMERIC := 0;
    v_payroll NUMERIC := 0;
    v_expenses NUMERIC := 0;
    v_room_cost NUMERIC := 0;
    v_months INTEGER;
BEGIN
    IF p_start IS NULL OR p_end IS NULL
       OR p_start > p_end
       OR p_basis NOT IN ('accrual', 'cash') THEN
        RAISE EXCEPTION 'KMS_INVALID_REPORT_PARAMETERS';
    END IF;

    IF EXTRACT(DAY FROM p_start) <> 1
       OR p_end <> (
           date_trunc('month', p_end)::date
           + INTERVAL '1 month'
           - INTERVAL '1 day'
       )::date THEN
        RAISE EXCEPTION 'KMS_REPORT_REQUIRES_FULL_MONTHS';
    END IF;

    v_months :=
        (EXTRACT(YEAR FROM age(p_end + 1, p_start)) * 12
         + EXTRACT(MONTH FROM age(p_end + 1, p_start)))::INTEGER;

    -- Нарахування розподіляємо пропорційно дням
    -- перетину періодів, щоб річний рахунок
    -- не потрапляв повністю в один місяць.
    IF p_basis = 'accrual' THEN

        SELECT COALESCE(SUM(
            i.total_amount *
            (
                LEAST(i.period_end, p_end)
                - GREATEST(i.period_start, p_start) + 1
            )::NUMERIC
            / (i.period_end - i.period_start + 1)
        ), 0)
        INTO v_revenue
        FROM invoices i
        WHERE i.status IN ('issued', 'paid')
          AND i.period_start <= p_end
          AND i.period_end >= p_start;

    ELSE

        SELECT COALESCE(SUM(amount), 0)
        INTO v_revenue
        FROM payments
        WHERE payment_date::date BETWEEN p_start AND p_end;

    END IF;

    SELECT COALESCE(SUM(net_salary), 0)
    INTO v_payroll
    FROM salaries
    WHERE period_start >= p_start
      AND period_end <= p_end;

    -- Зарплати тут не додаємо вдруге,
    -- бо беремо їх із таблиці salaries.
    SELECT COALESCE(SUM(amount), 0)
    INTO v_expenses
    FROM expenses
    WHERE date BETWEEN p_start AND p_end
      AND category <> 'salary';

    SELECT COUNT(*) *
           kms_salary_setting('room_normative', p_start)
           * v_months
    INTO v_room_cost
    FROM groups
    WHERE status = 'active';

    RETURN QUERY SELECT
        ROUND(v_revenue, 2),
        ROUND(v_payroll, 2),
        ROUND(v_expenses, 2),
        ROUND(v_revenue - v_payroll - v_expenses, 2),
        ROUND(v_room_cost, 2),
        ROUND(
            v_revenue - v_payroll
            - v_expenses - v_room_cost,
            2
        );
END;
$$;


-- Фінансовий звіт окремої групи
-- Без непрямих загальносадкових витрат

CREATE OR REPLACE FUNCTION kms_group_financial_report(
    p_group_id BIGINT,
    p_start DATE,
    p_end DATE
)
RETURNS TABLE (
    group_revenue NUMERIC,
    direct_salary_cost NUMERIC,
    direct_profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_revenue NUMERIC;
    v_salary NUMERIC;
BEGIN
    IF p_start IS NULL OR p_end IS NULL
       OR p_start > p_end THEN
        RAISE EXCEPTION 'KMS_INVALID_REPORT_PERIOD';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM groups WHERE id = p_group_id
    ) THEN
        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';
    END IF;

    SELECT COALESCE(SUM(
        i.total_amount *
        (
            LEAST(i.period_end, p_end)
            - GREATEST(i.period_start, p_start) + 1
        )::NUMERIC
        / (i.period_end - i.period_start + 1)
    ), 0)
    INTO v_revenue
    FROM invoices i
    WHERE i.parameters ->> 'group_id'
        = p_group_id::TEXT
      AND i.status IN ('issued', 'paid')
      AND i.period_start <= p_end
      AND i.period_end >= p_start;

    SELECT COALESCE(SUM(s.net_salary), 0)
    INTO v_salary
    FROM salaries s
    JOIN group_staff gs ON gs.employee_id = s.employee_id
    WHERE gs.group_id = p_group_id
      AND s.period_start >= p_start
      AND s.period_end <= p_end;

    RETURN QUERY SELECT
        ROUND(v_revenue, 2),
        ROUND(v_salary, 2),
        ROUND(v_revenue - v_salary, 2);
END;
$$;


-- Фінансовий прогноз для заданої
-- кількості дітей, груп та кімнат

CREATE OR REPLACE FUNCTION kms_forecast_groups(
    p_age INTEGER,
    p_children INTEGER,
    p_groups INTEGER,
    p_available_rooms INTEGER,
    p_meal_days INTEGER,
    p_food_cost_per_day NUMERIC,
    p_discount_percent NUMERIC DEFAULT 0
)
RETURNS TABLE (
    group_count INTEGER,
    rooms_needed INTEGER,
    monthly_revenue NUMERIC,
    payroll_cost NUMERIC,
    food_procurement_cost NUMERIC,
    operating_profit NUMERIC,
    modeled_profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_revenue NUMERIC;
    v_staff NUMERIC := 0;
    v_food NUMERIC;
    v_size INTEGER;
    v_i INTEGER;
    v_threshold INTEGER;
    v_room_cost NUMERIC;
BEGIN
    IF p_age IS NULL OR p_age NOT BETWEEN 2 AND 5
       OR p_children IS NULL OR p_children < 1
       OR p_groups IS NULL OR p_groups < 1
       OR p_available_rooms IS NULL
       OR p_available_rooms NOT BETWEEN 1 AND 20
       OR p_groups > p_available_rooms
       OR p_children > p_groups * 20
       OR p_meal_days IS NULL
       OR p_meal_days NOT BETWEEN 0 AND 31
       OR p_food_cost_per_day IS NULL
       OR p_food_cost_per_day < 0
       OR p_discount_percent IS NULL
       OR p_discount_percent NOT BETWEEN 0 AND 30 THEN
        RAISE EXCEPTION 'KMS_INVALID_FORECAST_SCENARIO';
    END IF;

    v_threshold := kms_salary_setting(
        'bonus_threshold'
    )::INTEGER;

    v_revenue :=
        p_children
        * kms_get_tuition_rate()
        * (1 - p_discount_percent / 100)
        +
        p_children * p_meal_days
        * kms_get_meal_rate(p_age);

    v_food :=
        p_children * p_meal_days
        * p_food_cost_per_day;

    -- Загальні зарплати менеджера
    -- і п'яти викладачів дисциплін.
    v_staff :=
        kms_salary_setting('manager_base')
        + 5 * kms_salary_setting('teacher_base');

    -- Розподіляємо дітей між групами
    -- максимально рівномірно.
    FOR v_i IN 1..p_groups LOOP

        v_size :=
            p_children / p_groups
            + CASE
                WHEN v_i <= p_children % p_groups
                THEN 1 ELSE 0
              END;

        -- Вихователь
        v_staff := v_staff
            + kms_salary_setting('educator_per_child')
                * v_size
            + kms_salary_setting('educator_extra')
                * GREATEST(0, v_size - v_threshold);

        -- Помічник
        v_staff := v_staff
            + kms_salary_setting('assistant_base')
            + kms_salary_setting('assistant_extra')
                * GREATEST(0, v_size - v_threshold);

    END LOOP;

    v_room_cost :=
        p_groups * kms_salary_setting('room_normative');

    RETURN QUERY SELECT
        p_groups,
        p_groups,
        ROUND(v_revenue, 2),
        ROUND(v_staff, 2),
        ROUND(v_food, 2),
        ROUND(v_revenue - v_staff - v_food, 2),
        ROUND(
            v_revenue - v_staff - v_food - v_room_cost,
            2
        );
END;
$$;


-- Пошук оптимальної кількості груп
-- серед допустимих конфігурацій

CREATE OR REPLACE FUNCTION kms_optimize_group_count(
    p_age INTEGER,
    p_children INTEGER,
    p_available_rooms INTEGER,
    p_meal_days INTEGER,
    p_food_cost_per_day NUMERIC,
    p_discount_percent NUMERIC DEFAULT 0
)
RETURNS TABLE (
    recommended_groups INTEGER,
    expected_operating_profit NUMERIC,
    expected_modeled_profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_children IS NULL OR p_children < 1
       OR p_available_rooms IS NULL
       OR p_available_rooms NOT BETWEEN 1 AND 20
       OR CEIL(p_children / 20.0) > p_available_rooms THEN
        RAISE EXCEPTION 'KMS_FORECAST_CAPACITY_EXCEEDED';
    END IF;

    RETURN QUERY
    SELECT
        f.group_count,
        f.operating_profit,
        f.modeled_profit
    FROM generate_series(
        CEIL(p_children / 20.0)::INTEGER,
        LEAST(p_available_rooms, p_children)
    ) AS n(group_total)
    CROSS JOIN LATERAL kms_forecast_groups(
        p_age,
        p_children,
        n.group_total,
        p_available_rooms,
        p_meal_days,
        p_food_cost_per_day,
        p_discount_percent
    ) AS f
    ORDER BY
        f.modeled_profit DESC,
        f.group_count ASC
    LIMIT 1;
END;
$$;