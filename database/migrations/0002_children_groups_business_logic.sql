-- Бізнес-логіка дітей, груп та кімнат
-- Kindergarten Management System
-- Міграція 0002

-- =========================================
-- 1. Розрахунок віку дитини
-- =========================================

CREATE OR REPLACE FUNCTION calculate_child_age(
    p_birth_date DATE,
    p_on_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_birth_date IS NULL
          OR p_on_date IS NULL
          OR p_birth_date > p_on_date
        THEN NULL
        ELSE EXTRACT(
            YEAR FROM AGE(p_on_date, p_birth_date)
        )::INTEGER
    END;
$$;


-- =========================================
-- 2. Перевірка віку дитини для групи
-- =========================================

CREATE OR REPLACE FUNCTION check_child_age(
    p_birth_date DATE,
    p_group_age INTEGER,
    p_on_date DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        calculate_child_age(
            p_birth_date,
            p_on_date
        ) = p_group_age
        AND p_group_age BETWEEN 2 AND 5,
        FALSE
    );
$$;


-- =========================================
-- 3. Перевірка місткості кімнати
-- =========================================

CREATE OR REPLACE FUNCTION check_room_capacity(
    p_room_id BIGINT,
    p_needed_capacity INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT
                r.capacity >= p_needed_capacity
                AND r.status IN ('available', 'occupied')
                AND p_needed_capacity > 0
            FROM rooms r
            WHERE r.id = p_room_id
        ),
        FALSE
    );
$$;


-- =========================================
-- 4. Перевірка кількості місць у групі
-- =========================================

CREATE OR REPLACE FUNCTION check_group_capacity(
    p_group_id BIGINT
)
RETURNS TABLE (
    group_id BIGINT,
    children_count BIGINT,
    capacity INTEGER,
    free_places INTEGER
)
LANGUAGE SQL
STABLE
AS $$
    SELECT
        g.id,
        COUNT(c.id),
        LEAST(g.max_capacity, r.capacity),
        LEAST(g.max_capacity, r.capacity)
            - COUNT(c.id)::INTEGER
    FROM groups g
    JOIN rooms r ON r.id = g.room_id
    LEFT JOIN children c ON c.group_id = g.id
    WHERE g.id = p_group_id
    GROUP BY
        g.id,
        g.max_capacity,
        r.capacity;
$$;


-- =========================================
-- 5. Перевірка всіх умов зарахування
-- =========================================

CREATE OR REPLACE FUNCTION validate_group_assignment(
    p_birth_date DATE,
    p_group_id BIGINT,
    p_excluded_child_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_group RECORD;
    v_count BIGINT;
BEGIN

    -- Один спільний lock для операцій
    -- із дітьми, групами та кімнатами.
    PERFORM pg_advisory_xact_lock(2026, 1001);

    IF p_group_id IS NULL THEN
        RAISE EXCEPTION 'KMS_GROUP_REQUIRED';
    END IF;

    SELECT
        g.age_years,
        g.max_capacity,
        r.capacity AS room_capacity,
        r.status AS room_status
    INTO v_group
    FROM groups g
    JOIN rooms r ON r.id = g.room_id
    WHERE g.id = p_group_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_GROUP_NOT_FOUND';
    END IF;

    -- Перевірка віку
    IF NOT check_child_age(
        p_birth_date,
        v_group.age_years
    ) THEN
        RAISE EXCEPTION 'KMS_CHILD_AGE_MISMATCH';
    END IF;

    -- Перевірка доступності кімнати
    IF v_group.room_status
        NOT IN ('available', 'occupied') THEN
        RAISE EXCEPTION 'KMS_ROOM_UNAVAILABLE';
    END IF;

    -- Кількість дітей, крім поточної,
    -- якщо це оновлення її запису
    SELECT COUNT(*)
    INTO v_count
    FROM children
    WHERE group_id = p_group_id
      AND (
          p_excluded_child_id IS NULL
          OR id <> p_excluded_child_id
      );

    -- Місць не може бути більше,
    -- ніж дозволяють група та кімната
    IF v_count >= LEAST(
        v_group.max_capacity,
        v_group.room_capacity
    ) THEN
        RAISE EXCEPTION 'KMS_GROUP_FULL';
    END IF;

END;
$$;


-- =========================================
-- 6. Тригер захисту дітей
-- =========================================

CREATE OR REPLACE FUNCTION kms_children_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_age INTEGER;
    v_excluded_child_id BIGINT;
BEGIN

    PERFORM pg_advisory_xact_lock(2026, 1001);

    v_age := calculate_child_age(
        NEW.date_of_birth
    );

    -- Дозволений вік 2-5 років
    IF v_age IS NULL
       OR v_age NOT BETWEEN 2 AND 5 THEN
        RAISE EXCEPTION 'KMS_CHILD_AGE_OUT_OF_RANGE';
    END IF;

    IF NEW.group_id IS NOT NULL THEN

        v_excluded_child_id := NULL;

        IF TG_OP = 'UPDATE' THEN
            v_excluded_child_id := OLD.id;
        END IF;

        PERFORM validate_group_assignment(
            NEW.date_of_birth,
            NEW.group_id,
            v_excluded_child_id
        );

    END IF;

    RETURN NEW;

END;
$$;


CREATE TRIGGER trg_kms_children_guard
BEFORE INSERT OR UPDATE OF
    date_of_birth, group_id
ON children
FOR EACH ROW
EXECUTE FUNCTION kms_children_guard();


-- =========================================
-- 7. Тригер захисту груп
-- =========================================

CREATE OR REPLACE FUNCTION kms_groups_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_room RECORD;
    v_count BIGINT;
BEGIN

    PERFORM pg_advisory_xact_lock(2026, 1001);

    SELECT
        capacity,
        status
    INTO v_room
    FROM rooms
    WHERE id = NEW.room_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_ROOM_NOT_FOUND';
    END IF;

    -- Кімната повинна бути доступною
    IF v_room.status
        NOT IN ('available', 'occupied') THEN
        RAISE EXCEPTION 'KMS_ROOM_UNAVAILABLE';
    END IF;

    -- Група не може бути більшою за кімнату
    IF NEW.max_capacity > v_room.capacity THEN
        RAISE EXCEPTION 'KMS_GROUP_EXCEEDS_ROOM_CAPACITY';
    END IF;

    IF TG_OP = 'UPDATE' THEN

        SELECT COUNT(*)
        INTO v_count
        FROM children
        WHERE group_id = OLD.id;

        -- Заборонено зменшувати місткість
        -- нижче фактичної кількості дітей
        IF v_count > NEW.max_capacity THEN
            RAISE EXCEPTION
                'KMS_GROUP_CAPACITY_BELOW_OCCUPANCY';
        END IF;

        -- Після зміни вікової категорії
        -- всі діти повинні їй відповідати
        IF EXISTS (
            SELECT 1
            FROM children c
            WHERE c.group_id = OLD.id
              AND NOT check_child_age(
                  c.date_of_birth,
                  NEW.age_years
              )
        ) THEN
            RAISE EXCEPTION
                'KMS_GROUP_AGE_CHANGE_INVALID';
        END IF;

    END IF;

    RETURN NEW;

END;
$$;


CREATE TRIGGER trg_kms_groups_guard
BEFORE INSERT OR UPDATE OF
    room_id, age_years, max_capacity
ON groups
FOR EACH ROW
EXECUTE FUNCTION kms_groups_guard();


-- =========================================
-- 8. Тригер захисту кімнат
-- =========================================

CREATE OR REPLACE FUNCTION kms_rooms_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
BEGIN

    PERFORM pg_advisory_xact_lock(2026, 1001);

    IF TG_OP = 'INSERT' THEN

        SELECT COUNT(*)
        INTO v_count
        FROM rooms;

        -- За вимогами всього 20 кімнат
        IF v_count >= 20 THEN
            RAISE EXCEPTION 'KMS_ROOM_LIMIT_REACHED';
        END IF;

    ELSE

        -- Не можна зменшувати кімнату
        -- або робити її недоступною,
        -- якщо за нею закріплена група
        IF EXISTS (
            SELECT 1
            FROM groups g
            WHERE g.room_id = OLD.id
              AND (
                  NEW.capacity < g.max_capacity
                  OR NEW.status NOT IN (
                      'available',
                      'occupied'
                  )
              )
        ) THEN
            RAISE EXCEPTION
                'KMS_ASSIGNED_ROOM_CANNOT_CHANGE';
        END IF;

    END IF;

    RETURN NEW;

END;
$$;


CREATE TRIGGER trg_kms_rooms_guard
BEFORE INSERT OR UPDATE OF
    capacity, status
ON rooms
FOR EACH ROW
EXECUTE FUNCTION kms_rooms_guard();


-- =========================================
-- 9. Зарахування дитини до групи
-- =========================================

CREATE OR REPLACE FUNCTION assign_child_to_group(
    p_child_id BIGINT,
    p_group_id BIGINT
)
RETURNS children
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
BEGIN

    IF p_child_id IS NULL
       OR p_group_id IS NULL THEN
        RAISE EXCEPTION 'KMS_IDS_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1001);

    UPDATE children
    SET group_id = p_group_id
    WHERE id = p_child_id
      AND group_id IS NULL
    RETURNING * INTO v_child;

    IF NOT FOUND THEN

        IF NOT EXISTS (
            SELECT 1
            FROM children
            WHERE id = p_child_id
        ) THEN
            RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
        END IF;

        RAISE EXCEPTION 'KMS_CHILD_ALREADY_ASSIGNED';

    END IF;

    RETURN v_child;

END;
$$;


-- =========================================
-- 10. Переведення дитини до іншої групи
-- =========================================

CREATE OR REPLACE FUNCTION transfer_child_to_group(
    p_child_id BIGINT,
    p_new_group_id BIGINT
)
RETURNS children
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
BEGIN

    IF p_child_id IS NULL
       OR p_new_group_id IS NULL THEN
        RAISE EXCEPTION 'KMS_IDS_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1001);

    UPDATE children
    SET group_id = p_new_group_id
    WHERE id = p_child_id
      AND group_id IS NOT NULL
      AND group_id <> p_new_group_id
    RETURNING * INTO v_child;

    IF NOT FOUND THEN

        IF NOT EXISTS (
            SELECT 1
            FROM children
            WHERE id = p_child_id
        ) THEN
            RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
        END IF;

        RAISE EXCEPTION 'KMS_TRANSFER_NOT_APPLICABLE';

    END IF;

    RETURN v_child;

END;
$$;


-- =========================================
-- 11. Виключення дитини з групи
-- =========================================

CREATE OR REPLACE FUNCTION remove_child_from_group(
    p_child_id BIGINT
)
RETURNS children
LANGUAGE plpgsql
AS $$
DECLARE
    v_child children%ROWTYPE;
BEGIN

    IF p_child_id IS NULL THEN
        RAISE EXCEPTION 'KMS_CHILD_ID_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(2026, 1001);

    UPDATE children
    SET group_id = NULL
    WHERE id = p_child_id
      AND group_id IS NOT NULL
    RETURNING * INTO v_child;

    IF NOT FOUND THEN

        IF NOT EXISTS (
            SELECT 1
            FROM children
            WHERE id = p_child_id
        ) THEN
            RAISE EXCEPTION 'KMS_CHILD_NOT_FOUND';
        END IF;

        RAISE EXCEPTION 'KMS_CHILD_NOT_ASSIGNED';

    END IF;

    RETURN v_child;

END;
$$;


-- =========================================
-- 12. Перевірка вже існуючих даних
-- =========================================

DO $preflight$
BEGIN

    IF (SELECT COUNT(*) FROM rooms) > 20 THEN
        RAISE EXCEPTION 'KMS_PREFLIGHT_TOO_MANY_ROOMS';
    END IF;

    -- Перевіряємо, чи підходять
    -- кімнати вже створеним групам
    IF EXISTS (
        SELECT 1
        FROM groups g
        JOIN rooms r ON r.id = g.room_id
        WHERE g.max_capacity > r.capacity
           OR r.status NOT IN (
               'available',
               'occupied'
           )
    ) THEN
        RAISE EXCEPTION
            'KMS_PREFLIGHT_GROUP_ROOM_INVALID';
    END IF;

    -- Чи немає вже переповнених груп
    IF EXISTS (
        SELECT 1
        FROM groups g
        JOIN rooms r ON r.id = g.room_id
        LEFT JOIN children c ON c.group_id = g.id
        GROUP BY
            g.id,
            g.max_capacity,
            r.capacity
        HAVING COUNT(c.id) > LEAST(
            g.max_capacity,
            r.capacity
        )
    ) THEN
        RAISE EXCEPTION
            'KMS_PREFLIGHT_GROUP_OVERFULL';
    END IF;

    -- Перевіряємо вік усіх дітей
    IF EXISTS (
        SELECT 1
        FROM children c
        WHERE calculate_child_age(c.date_of_birth)
              NOT BETWEEN 2 AND 5
    ) THEN
        RAISE EXCEPTION
            'KMS_PREFLIGHT_CHILD_AGE_INVALID';
    END IF;

    -- Перевіряємо відповідність групі
    IF EXISTS (
        SELECT 1
        FROM children c
        JOIN groups g ON g.id = c.group_id
        WHERE NOT check_child_age(
            c.date_of_birth,
            g.age_years
        )
    ) THEN
        RAISE EXCEPTION
            'KMS_PREFLIGHT_GROUP_AGE_INVALID';
    END IF;

END;
$preflight$;