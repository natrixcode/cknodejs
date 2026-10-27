
-- =====================================================
-- MIGRATION 0004
-- KINDERGARTEN MANAGEMENT SYSTEM
-- BUSINESS LOGIC: EMPLOYEES AND GROUP STAFF
-- =====================================================

-- =========================================
-- 1. Статуси груп
-- =========================================

-- draft    - група готується
-- active   - група активна
-- inactive - група неактивна

ALTER TABLE public.groups
ADD COLUMN status VARCHAR(10)
NOT NULL DEFAULT 'draft'
CHECK (status IN ('draft', 'active', 'inactive'));


-- =========================================
-- 2. Перевірка існуючих призначень
-- =========================================

-- Якщо старі дані суперечать правилам,
-- міграція зупиниться без часткових змін.

DO $$
BEGIN

    -- Працівник повинен мати відповідну
    -- посаду та активний статус.

    IF EXISTS (
        SELECT 1
        FROM public.group_staff gs
        JOIN public.employees e
            ON e.id = gs.employee_id
        WHERE e.position <> gs.role
           OR e.status <> 'active'
    ) THEN

        RAISE EXCEPTION
            'KMS_EXISTING_STAFF_ASSIGNMENT_INVALID';

    END IF;

    -- Один працівник не повинен бути
    -- закріплений за декількома групами.

    IF EXISTS (
        SELECT 1
        FROM public.group_staff
        GROUP BY employee_id
        HAVING COUNT(*) > 1
    ) THEN

        RAISE EXCEPTION
            'KMS_EMPLOYEE_ASSIGNED_TO_MULTIPLE_GROUPS';

    END IF;

END;
$$;


-- =========================================
-- 3. Один працівник - одна група
-- =========================================

CREATE UNIQUE INDEX
    uq_kms_group_staff_employee
ON public.group_staff(employee_id);


-- =========================================
-- 4. Захист призначення працівників
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_group_staff_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_position VARCHAR(50);
    v_employee_status VARCHAR(20);
    v_group_status VARCHAR(10);

    v_old_group_id BIGINT;
    v_old_role VARCHAR(20);
BEGIN

    -- Захист від одночасних призначень

    PERFORM pg_advisory_xact_lock(2026, 1002);


    -- =====================================
    -- Видалення призначення
    -- =====================================

    IF TG_OP = 'DELETE' THEN

        SELECT status
        INTO v_group_status
        FROM public.groups
        WHERE id = OLD.group_id;

        IF v_group_status = 'active' THEN

            RAISE EXCEPTION
                'KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE';

        END IF;

        RETURN OLD;

    END IF;


    -- =====================================
    -- Оновлення призначення
    -- =====================================

    v_old_group_id := NULL;
    v_old_role := NULL;

    IF TG_OP = 'UPDATE' THEN

        v_old_group_id := OLD.group_id;
        v_old_role := OLD.role;

        SELECT status
        INTO v_group_status
        FROM public.groups
        WHERE id = OLD.group_id;

        IF v_group_status = 'active' THEN

            RAISE EXCEPTION
                'KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE';

        END IF;

    END IF;


    -- =====================================
    -- Перевірка нової групи
    -- =====================================

    SELECT status
    INTO v_group_status
    FROM public.groups
    WHERE id = NEW.group_id;

    IF NOT FOUND THEN

        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';

    END IF;

    IF v_group_status = 'active' THEN

        RAISE EXCEPTION
            'KMS_DEACTIVATE_GROUP_BEFORE_STAFF_CHANGE';

    END IF;


    -- =====================================
    -- Перевірка працівника
    -- =====================================

    SELECT position, status
    INTO v_position, v_employee_status
    FROM public.employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND THEN

        RAISE EXCEPTION 'KMS_EMPLOYEE_NOT_FOUND';

    END IF;


    -- Працівник повинен бути активним

    IF v_employee_status <> 'active' THEN

        RAISE EXCEPTION 'KMS_EMPLOYEE_INACTIVE';

    END IF;


    -- Посада повинна відповідати ролі

    IF v_position <> NEW.role THEN

        RAISE EXCEPTION
            'KMS_EMPLOYEE_ROLE_MISMATCH';

    END IF;


    -- =====================================
    -- Перевірка повторного призначення
    -- =====================================

    IF EXISTS (
        SELECT 1
        FROM public.group_staff gs
        WHERE gs.employee_id = NEW.employee_id
          AND (
              gs.group_id,
              gs.role
          ) IS DISTINCT FROM (
              v_old_group_id,
              v_old_role
          )
    ) THEN

        RAISE EXCEPTION
            'KMS_EMPLOYEE_ALREADY_ASSIGNED';

    END IF;


    RETURN NEW;

END;
$$;


-- =========================================
-- 5. Тригер призначення працівників
-- =========================================

CREATE TRIGGER trg_kms_group_staff_guard
BEFORE INSERT OR UPDATE OR DELETE
ON public.group_staff
FOR EACH ROW
EXECUTE FUNCTION public.kms_group_staff_guard();


-- =========================================
-- 6. Перевірка комплектності групи
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_group_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_educators INTEGER;
    v_assistants INTEGER;
BEGIN

    PERFORM pg_advisory_xact_lock(2026, 1002);

    -- Перевіряємо тільки активні групи

    IF NEW.status = 'active' THEN

        -- Кількість активних вихователів

        SELECT COUNT(*)::INTEGER
        INTO v_educators
        FROM public.group_staff gs
        JOIN public.employees e
            ON e.id = gs.employee_id
        WHERE gs.group_id = NEW.id
          AND gs.role = 'educator'
          AND e.position = 'educator'
          AND e.status = 'active';


        -- Кількість активних помічників

        SELECT COUNT(*)::INTEGER
        INTO v_assistants
        FROM public.group_staff gs
        JOIN public.employees e
            ON e.id = gs.employee_id
        WHERE gs.group_id = NEW.id
          AND gs.role = 'assistant'
          AND e.position = 'assistant'
          AND e.status = 'active';


        -- Потрібен рівно один вихователь
        -- та рівно один помічник

        IF v_educators <> 1
           OR v_assistants <> 1 THEN

            RAISE EXCEPTION
                'KMS_GROUP_REQUIRES_EDUCATOR_AND_ASSISTANT';

        END IF;

    END IF;

    RETURN NEW;

END;
$$;


-- =========================================
-- 7. Тригер активації групи
-- =========================================

CREATE TRIGGER trg_kms_group_status_guard
BEFORE INSERT OR UPDATE OF status
ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.kms_group_status_guard();


-- =========================================
-- 8. Захист посади та статусу працівника
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_employee_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    PERFORM pg_advisory_xact_lock(2026, 1002);

    -- Якщо працівник призначений до групи,
    -- не можна змінювати його посаду
    -- на несумісну або деактивувати його.

    IF EXISTS (
        SELECT 1
        FROM public.group_staff gs
        WHERE gs.employee_id = NEW.id
          AND (
              NEW.position <> gs.role
              OR NEW.status <> 'active'
          )
    ) THEN

        RAISE EXCEPTION
            'KMS_EMPLOYEE_HAS_INCOMPATIBLE_ASSIGNMENT';

    END IF;

    RETURN NEW;

END;
$$;


-- =========================================
-- 9. Тригер зміни статусу працівника
-- =========================================

CREATE TRIGGER trg_kms_employee_status_guard
BEFORE UPDATE OF position, status
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.kms_employee_status_guard();


-- =========================================
-- 10. Призначення працівника до групи
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_assign_employee_to_group(
    p_group_id BIGINT,
    p_employee_id BIGINT,
    p_role VARCHAR
)
RETURNS public.group_staff
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.group_staff%ROWTYPE;
BEGIN

    -- Перевірка обов'язкових параметрів

    IF p_group_id IS NULL
       OR p_employee_id IS NULL
       OR p_role IS NULL THEN

        RAISE EXCEPTION 'KMS_INVALID_STAFF_PARAMETERS';

    END IF;


    -- Допустимі ролі

    IF p_role NOT IN ('educator', 'assistant') THEN

        RAISE EXCEPTION 'KMS_INVALID_STAFF_ROLE';

    END IF;


    -- Блокування одночасних операцій

    PERFORM pg_advisory_xact_lock(2026, 1002);


    -- Створення призначення.
    -- Тригер перевірить групу і працівника.

    INSERT INTO public.group_staff (
        group_id,
        employee_id,
        role
    )
    VALUES (
        p_group_id,
        p_employee_id,
        p_role
    )
    RETURNING * INTO v_result;


    RETURN v_result;

END;
$$;


-- =========================================
-- 11. Зняття працівника з групи
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_remove_employee_from_group(
    p_group_id BIGINT,
    p_employee_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN

    IF p_group_id IS NULL
       OR p_employee_id IS NULL THEN

        RAISE EXCEPTION 'KMS_INVALID_STAFF_PARAMETERS';

    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1002);


    DELETE FROM public.group_staff
    WHERE group_id = p_group_id
      AND employee_id = p_employee_id;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'KMS_GROUP_STAFF_NOT_FOUND';

    END IF;

END;
$$;


-- =========================================
-- 12. Активація групи
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_activate_group(
    p_group_id BIGINT
)
RETURNS public.groups
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.groups%ROWTYPE;
BEGIN

    IF p_group_id IS NULL THEN

        RAISE EXCEPTION 'KMS_GROUP_ID_REQUIRED';

    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1002);


    -- Тригер автоматично перевірить,
    -- чи є вихователь та помічник.

    UPDATE public.groups
    SET status = 'active'
    WHERE id = p_group_id
    RETURNING * INTO v_result;


    IF NOT FOUND THEN

        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';

    END IF;


    RETURN v_result;

END;
$$;


-- =========================================
-- 13. Деактивація групи
-- =========================================

CREATE OR REPLACE FUNCTION
public.kms_deactivate_group(
    p_group_id BIGINT
)
RETURNS public.groups
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.groups%ROWTYPE;
BEGIN

    IF p_group_id IS NULL THEN

        RAISE EXCEPTION 'KMS_GROUP_ID_REQUIRED';

    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1002);


    UPDATE public.groups
    SET status = 'inactive'
    WHERE id = p_group_id
    RETURNING * INTO v_result;


    IF NOT FOUND THEN

        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';

    END IF;


    RETURN v_result;

END;
$$;
