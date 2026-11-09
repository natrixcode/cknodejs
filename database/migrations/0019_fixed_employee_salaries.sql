
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

    IF v_employee.position = 'manager' THEN

        v_result := kms_salary_setting(
            'manager_base', p_date
        );

    ELSIF v_employee.position = 'teacher' THEN

        v_result := kms_salary_setting(
            'teacher_base', p_date
        );

    ELSIF v_employee.position IN ('educator', 'assistant') THEN

            v_threshold := kms_salary_setting(
            'bonus_threshold', p_date
        )::INTEGER;

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

    ELSIF v_employee.position IN (
        'director', 'cook', 'nurse', 'accountant'
    ) THEN

        v_result := v_employee.salary;

    ELSE
        RAISE EXCEPTION 'KMS_SALARY_RULE_NOT_DEFINED';
    END IF;

    RETURN ROUND(v_result, 2);
END;
$$;
