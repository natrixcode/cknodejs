-- 0009: Salary business logic

CREATE TABLE kms_salary_parameters (
    name VARCHAR(60) NOT NULL,
    valid_from DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (name, valid_from)
);

INSERT INTO kms_salary_parameters(
    name, valid_from, amount
)
VALUES
('educator_per_child', DATE '2020-01-01', 2000),
('educator_extra', DATE '2020-01-01', 5000),
('assistant_base', DATE '2020-01-01', 20000),
('assistant_extra', DATE '2020-01-01', 3000),
('manager_base', DATE '2020-01-01', 80000),
('teacher_base', DATE '2020-01-01', 40000),
('bonus_threshold', DATE '2020-01-01', 12),
('room_normative', DATE '2020-01-01', 50000);


-- Отримати чинне значення параметра

CREATE OR REPLACE FUNCTION kms_salary_setting(
    p_name VARCHAR,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_amount NUMERIC;
BEGIN
    SELECT amount INTO v_amount
    FROM kms_salary_parameters
    WHERE name = p_name
      AND valid_from <= p_date
    ORDER BY valid_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_SALARY_PARAMETER_NOT_FOUND';
    END IF;

    RETURN v_amount;
END;
$$;


-- Зміна зарплатного параметра

CREATE OR REPLACE FUNCTION kms_set_salary_setting(
    p_name VARCHAR,
    p_amount NUMERIC,
    p_valid_from DATE
)
RETURNS kms_salary_parameters
LANGUAGE plpgsql
AS $$
DECLARE
    v_result kms_salary_parameters%ROWTYPE;
BEGIN
    IF p_name IS NULL OR btrim(p_name) = ''
       OR p_amount IS NULL OR p_amount < 0
       OR p_valid_from IS NULL THEN
        RAISE EXCEPTION 'KMS_INVALID_SALARY_SETTING';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM kms_salary_parameters
        WHERE name = p_name
    ) THEN
        RAISE EXCEPTION 'KMS_UNKNOWN_SALARY_SETTING';
    END IF;

    IF p_name = 'bonus_threshold'
       AND p_amount <> trunc(p_amount) THEN
        RAISE EXCEPTION 'KMS_INVALID_THRESHOLD';
    END IF;

    INSERT INTO kms_salary_parameters(
        name, amount, valid_from
    )
    VALUES (p_name, p_amount, p_valid_from)
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Розрахувати зарплату конкретного працівника

CREATE OR REPLACE FUNCTION kms_calculate_employee_salary(
    p_employee_id BIGINT,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_employee employees%ROWTYPE;
    v_children INTEGER;
    v_threshold INTEGER;
    v_result NUMERIC;
BEGIN
    SELECT * INTO v_employee
    FROM employees
    WHERE id = p_employee_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_EMPLOYEE_NOT_FOUND';
    END IF;

    IF v_employee.status <> 'active' THEN
        RAISE EXCEPTION 'KMS_EMPLOYEE_NOT_ACTIVE';
    END IF;

    v_threshold := kms_salary_setting(
        'bonus_threshold', p_date
    )::INTEGER;

    IF v_employee.position = 'manager' THEN

        v_result := kms_salary_setting(
            'manager_base', p_date
        );

    ELSIF v_employee.position = 'teacher' THEN

        v_result := kms_salary_setting(
            'teacher_base', p_date
        );

    ELSIF v_employee.position IN ('educator', 'assistant') THEN

        SELECT COUNT(c.id)::INTEGER
        INTO v_children
        FROM group_staff gs
        LEFT JOIN children c ON c.group_id = gs.group_id
        WHERE gs.employee_id = p_employee_id;

        IF v_employee.position = 'educator' THEN

            v_result :=
                kms_salary_setting(
                    'educator_per_child', p_date
                ) * v_children
                +
                kms_salary_setting(
                    'educator_extra', p_date
                ) * GREATEST(
                    0, v_children - v_threshold
                );

        ELSE

            v_result :=
                kms_salary_setting(
                    'assistant_base', p_date
                )
                +
                kms_salary_setting(
                    'assistant_extra', p_date
                ) * GREATEST(
                    0, v_children - v_threshold
                );

        END IF;

    ELSE
        RAISE EXCEPTION 'KMS_SALARY_RULE_NOT_DEFINED';
    END IF;

    RETURN ROUND(v_result, 2);
END;
$$;


-- Захист від повторного нарахування
-- за той самий період

CREATE UNIQUE INDEX kms_salary_unique_period
ON salaries(employee_id, period_start, period_end);


-- Створити місячне зарплатне нарахування

CREATE OR REPLACE FUNCTION kms_create_salary(
    p_employee_id BIGINT,
    p_period_start DATE
)
RETURNS salaries
LANGUAGE plpgsql
AS $$
DECLARE
    v_amount NUMERIC;
    v_end_date DATE;
    v_result salaries%ROWTYPE;
BEGIN
    IF p_period_start IS NULL
       OR EXTRACT(DAY FROM p_period_start) <> 1 THEN
        RAISE EXCEPTION 'KMS_INVALID_SALARY_PERIOD';
    END IF;

    v_end_date := (
        p_period_start + INTERVAL '1 month'
        - INTERVAL '1 day'
    )::DATE;

    v_amount := kms_calculate_employee_salary(
        p_employee_id, p_period_start
    );

    INSERT INTO salaries (
        employee_id, period_start, period_end,
        base_salary, bonus, deductions, currency
    )
    VALUES (
        p_employee_id, p_period_start, v_end_date,
        v_amount, 0, 0, 'UAH'
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;