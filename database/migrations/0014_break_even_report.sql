-- 0014: Break-even report

-- Мінімальна беззбиткова конфігурація:
-- найменша кількість дітей (і для неї найменша
-- кількість груп), за якої модельований місячний
-- прибуток kms_forecast_groups не менший за нуль.
-- Це не пошук максимального прибутку
-- (див. kms_optimize_group_count).

CREATE OR REPLACE FUNCTION kms_break_even(
    p_age INTEGER,
    p_available_rooms INTEGER,
    p_meal_days INTEGER,
    p_food_cost_per_day NUMERIC,
    p_discount_percent NUMERIC DEFAULT 0
)
RETURNS TABLE (
    reachable BOOLEAN,
    children_count INTEGER,
    group_count INTEGER,
    monthly_revenue NUMERIC,
    payroll_cost NUMERIC,
    food_procurement_cost NUMERIC,
    room_model_cost NUMERIC,
    modeled_profit NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_children INTEGER;
    v_groups INTEGER;
    v_forecast RECORD;
BEGIN
    IF p_age IS NULL OR p_age NOT BETWEEN 2 AND 5
       OR p_available_rooms IS NULL
       OR p_available_rooms NOT BETWEEN 1 AND 20
       OR p_meal_days IS NULL
       OR p_meal_days NOT BETWEEN 0 AND 31
       OR p_food_cost_per_day IS NULL
       OR p_food_cost_per_day < 0
       OR p_discount_percent IS NULL
       OR p_discount_percent NOT BETWEEN 0 AND 30 THEN
        RAISE EXCEPTION 'KMS_INVALID_FORECAST_SCENARIO';
    END IF;

    -- Перебираємо від меншої кількості дітей до більшої:
    -- перший прибутковий варіант і є точкою беззбитковості.
    FOR v_children IN 1..p_available_rooms * 20 LOOP
        FOR v_groups IN
            CEIL(v_children / 20.0)::INTEGER
            ..LEAST(p_available_rooms, v_children)
        LOOP
            SELECT * INTO v_forecast
            FROM kms_forecast_groups(
                p_age,
                v_children,
                v_groups,
                p_available_rooms,
                p_meal_days,
                p_food_cost_per_day,
                p_discount_percent
            );

            IF v_forecast.modeled_profit >= 0 THEN
                RETURN QUERY SELECT
                    TRUE,
                    v_children,
                    v_groups,
                    v_forecast.monthly_revenue,
                    v_forecast.payroll_cost,
                    v_forecast.food_procurement_cost,
                    v_forecast.operating_profit
                        - v_forecast.modeled_profit,
                    v_forecast.modeled_profit;
                RETURN;
            END IF;
        END LOOP;
    END LOOP;

    -- Навіть за повного завантаження кімнат прибутку немає.
    RETURN QUERY SELECT
        FALSE,
        NULL::INTEGER,
        NULL::INTEGER,
        NULL::NUMERIC,
        NULL::NUMERIC,
        NULL::NUMERIC,
        NULL::NUMERIC,
        NULL::NUMERIC;
END;
$$;
