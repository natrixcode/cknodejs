
-- Kindergarten Management System
-- Initial schema draft

-- 1. Rooms
CREATE TABLE rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Groups
CREATE TABLE groups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    room_id BIGINT NOT NULL UNIQUE REFERENCES rooms(id),
    max_capacity INTEGER NOT NULL DEFAULT 20
        CHECK (max_capacity BETWEEN 1 AND 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. Children
CREATE TABLE children (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    date_of_birth DATE NOT NULL
        CHECK (date_of_birth < CURRENT_DATE),
    group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Parents and guardians
CREATE TABLE parents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Relationship between children and parents
CREATE TABLE children_parents (
    child_id BIGINT NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,
    parent_id BIGINT NOT NULL
        REFERENCES parents(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) NOT NULL DEFAULT 'parent',
    PRIMARY KEY (child_id, parent_id)
);

-- Indexes for common lookups
CREATE INDEX idx_children_group_id ON children(group_id);
CREATE INDEX idx_children_last_name ON children(last_name);


-- 6. Employees
CREATE TABLE employees (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    position VARCHAR(50) NOT NULL
        CHECK (position IN (
            'manager',
            'educator',
            'assistant',
            'teacher'
        )),
    phone VARCHAR(20) NOT NULL UNIQUE,
    salary NUMERIC(12, 2) NOT NULL CHECK (salary >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Employee assignments to groups
CREATE TABLE group_staff (
    group_id BIGINT NOT NULL
        REFERENCES groups(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL
        REFERENCES employees(id) ON DELETE RESTRICT,
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('educator', 'assistant')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, employee_id, role),
    UNIQUE (group_id, role)
);


-- 8. Subjects
CREATE TABLE subjects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Subjects that employees can teach
CREATE TABLE employee_subjects (
    employee_id BIGINT NOT NULL
        REFERENCES employees(id) ON DELETE CASCADE,
    subject_id BIGINT NOT NULL
        REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, subject_id)
);


-- 10. Schedule
CREATE TABLE schedule (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    group_id BIGINT NOT NULL
        REFERENCES groups(id) ON DELETE RESTRICT,

    subject_id BIGINT NOT NULL
        REFERENCES subjects(id) ON DELETE RESTRICT,

    teacher_id BIGINT NOT NULL
        REFERENCES employees(id) ON DELETE RESTRICT,

    room_id BIGINT NOT NULL
        REFERENCES rooms(id) ON DELETE RESTRICT,

    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (end_time > start_time)
);

CREATE INDEX idx_schedule_group_id
    ON schedule(group_id);

CREATE INDEX idx_schedule_teacher_id
    ON schedule(teacher_id);

CREATE INDEX idx_schedule_room_id
    ON schedule(room_id);

CREATE INDEX idx_schedule_start_time
    ON schedule(start_time);


-- 11. Meal prices by child age
CREATE TABLE meal_prices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    age_years INTEGER NOT NULL UNIQUE
        CHECK (age_years BETWEEN 2 AND 5),
    price_per_day NUMERIC(10, 2) NOT NULL
        CHECK (price_per_day >= 0),
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



-- 12. Discounts
CREATE TABLE discounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    percentage NUMERIC(5, 2) NOT NULL
        CHECK (percentage IN (10, 20, 30)),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 13. System users
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('admin', 'manager', 'parent', 'employee')),
    parent_id BIGINT UNIQUE
        REFERENCES parents(id) ON DELETE RESTRICT,
    employee_id BIGINT UNIQUE
        REFERENCES employees(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (role = 'parent' AND parent_id IS NOT NULL
            AND employee_id IS NULL)
        OR
        (role IN ('admin', 'manager') AND parent_id IS NULL
            AND employee_id IS NULL)
        OR
        (role = 'employee' AND employee_id IS NOT NULL
            AND parent_id IS NULL)
    )
);
