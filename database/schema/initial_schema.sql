-- Kindergarten Management System
-- Complete PostgreSQL schema blueprint for the original 13 tables and
-- the entities covered by the 18 existing Zod validators.
--
-- LOCATION: database/schema/initial_schema.sql
-- IMPORTANT: This is NOT a migration. npm run db:migrate reads ONLY
-- database/migrations/*.sql. Execute this blueprint only on a CLEAN DB;
-- changing this file does not alter existing database tables.
--
-- API naming (camelCase, name/surname/birthday, date + startTime) is mapped
-- to SQL snake_case in controllers / SQL function arguments. Storing a raw
-- password is NOT supported; the controller must hash it first.

-- ============================================================
-- 1. ROOMS (room_validator.js)
-- ============================================================
CREATE TABLE rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Retained for existing SQL users; the validator instead sends "name".
    room_number VARCHAR(20) UNIQUE,
    name VARCHAR(50) UNIQUE,
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'occupied', 'maintenance', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (room_number IS NOT NULL OR name IS NOT NULL)
);

-- ============================================================
-- 2. GROUPS (group_validator.js)
-- ============================================================
CREATE TABLE groups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    room_id BIGINT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE RESTRICT,
    -- Groups are age-homogeneous. min_age and max_age from the validator
    -- must agree and be mapped to age_years by the controller.
    age_years SMALLINT NOT NULL CHECK (age_years BETWEEN 2 AND 5),
    max_capacity INTEGER NOT NULL DEFAULT 20
        CHECK (max_capacity BETWEEN 1 AND 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. CHILDREN (child_validator.js)
-- ============================================================
CREATE TABLE children (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(first_name)) > 0),
    last_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(last_name)) > 0),
    date_of_birth DATE NOT NULL CHECK (date_of_birth < CURRENT_DATE),
    group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
    dietary_preferences TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_children_group_id ON children(group_id);
CREATE INDEX idx_children_last_name ON children(last_name);

-- ============================================================
-- 4. PARENTS / GUARDIANS (parent_validator.js)
-- ============================================================
CREATE TABLE parents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(first_name)) > 0),
    last_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(last_name)) > 0),
    phone VARCHAR(20) NOT NULL UNIQUE,
    -- Legacy schema allows a parent without email; API validator requires it.
    email VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. CHILDREN <-> PARENTS
-- ============================================================
CREATE TABLE children_parents (
    child_id BIGINT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    parent_id BIGINT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) NOT NULL DEFAULT 'parent',
    PRIMARY KEY (child_id, parent_id)
);
CREATE INDEX idx_children_parents_parent_id ON children_parents(parent_id);

-- ============================================================
-- 6. EMPLOYEES (employee_validator.js)
-- ============================================================
CREATE TABLE employees (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(first_name)) > 0),
    last_name VARCHAR(50) NOT NULL CHECK (LENGTH(BTRIM(last_name)) > 0),
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20) NOT NULL UNIQUE,
    -- Includes both the original four roles and values accepted by Zod.
    position VARCHAR(50) NOT NULL CHECK (position IN (
        'manager', 'educator', 'assistant', 'teacher',
        'director', 'cook', 'nurse', 'accountant'
    )),
    salary NUMERIC(12,2) NOT NULL CHECK (salary BETWEEN 0 AND 100000000),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'on_leave')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. ASSIGNMENTS TO GROUPS
-- ============================================================
CREATE TABLE group_staff (
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    role VARCHAR(20) NOT NULL CHECK (role IN ('educator', 'assistant')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, employee_id, role),
    UNIQUE (group_id, role),
    UNIQUE (employee_id, role)
);

-- ============================================================
-- 8. SUBJECTS (subject_validator.js)
-- ============================================================
CREATE TABLE subjects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT CHECK (description IS NULL OR LENGTH(description) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. EMPLOYEES <-> SUBJECTS
-- employeeIds array must become rows in this table.
-- ============================================================
CREATE TABLE employee_subjects (
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, subject_id)
);
CREATE INDEX idx_employee_subjects_subject_id ON employee_subjects(subject_id);

-- ============================================================
-- 10. SCHEDULE (schedule_validator.js)
-- ============================================================
CREATE TABLE schedule (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    -- A draft can have an unassigned subject; publishing needs a subject.
    subject_id BIGINT REFERENCES subjects(id) ON DELETE RESTRICT,
    teacher_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    -- The validator provides date + startTime/endTime. Controllers combine
    -- these with the institution timezone into timestamptz values.
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time),
    CHECK (status <> 'published' OR subject_id IS NOT NULL)
);
CREATE INDEX idx_schedule_group_id ON schedule(group_id);
CREATE INDEX idx_schedule_subject_id ON schedule(subject_id);
CREATE INDEX idx_schedule_teacher_id ON schedule(teacher_id);
CREATE INDEX idx_schedule_room_id ON schedule(room_id);
CREATE INDEX idx_schedule_start_time ON schedule(start_time);

-- ============================================================
-- 11. MEAL PRICES (original age-based meal tariff)
-- ============================================================
CREATE TABLE meal_prices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    age_years INTEGER NOT NULL CHECK (age_years BETWEEN 2 AND 5),
    price_per_day NUMERIC(10,2) NOT NULL CHECK (price_per_day >= 0),
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (age_years, valid_from)
);

-- ============================================================
-- 12. DISCOUNTS (discount_validator.js + legacy percentage)
-- ============================================================
CREATE TABLE discounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    -- Legacy 10/20/30 percent discounts remain representable.
    percentage NUMERIC(5,2) CHECK (percentage IN (10,20,30)),
    -- New validator also accepts fixed and arbitrary percent discounts.
    type VARCHAR(10) NOT NULL DEFAULT 'percent'
        CHECK (type IN ('fixed', 'percent')),
    value NUMERIC(12,2) CHECK (value > 0),
    currency VARCHAR(3) CHECK (currency IN ('UAH','USD','EUR')),
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (value IS NOT NULL OR percentage IS NOT NULL),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK (type <> 'percent' OR COALESCE(value, percentage) <= 100),
    CHECK (type <> 'fixed' OR (value IS NOT NULL AND currency IS NOT NULL
        AND percentage IS NULL)),
    CHECK (value IS NULL OR percentage IS NULL OR
        (type = 'percent' AND value = percentage))
);

-- Child discount assignments: avoid storing an array of discount IDs.
CREATE TABLE child_discounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    child_id BIGINT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
    discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);
CREATE UNIQUE INDEX uq_child_discounts_active_child
    ON child_discounts(child_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_child_discounts_discount_id ON child_discounts(discount_id);

-- ============================================================
-- 13. USERS (users_validator.js and auth_validator.js)
-- ============================================================
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Old username login is supported; email/name also suit users_validator.
    username VARCHAR(50) UNIQUE,
    name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    -- Never store plaintext password from the Zod request.
    password_hash TEXT NOT NULL CHECK (LENGTH(password_hash) > 0),
    -- Union of original system roles and validator role values.
    role VARCHAR(20) NOT NULL CHECK (role IN (
        'admin','manager','parent','employee','teacher','user','moderator'
    )),
    parent_id BIGINT UNIQUE REFERENCES parents(id) ON DELETE RESTRICT,
    employee_id BIGINT UNIQUE REFERENCES employees(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','blocked','pending')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (username IS NOT NULL OR email IS NOT NULL),
    CHECK (
        (role = 'parent' AND parent_id IS NOT NULL AND employee_id IS NULL)
        OR (role IN ('employee','teacher') AND employee_id IS NOT NULL
            AND parent_id IS NULL)
        OR (role IN ('admin','manager','user','moderator')
            AND parent_id IS NULL AND employee_id IS NULL)
    )
);

-- ============================================================
-- 14. FOOD RATES (food_validator.js)
-- Independent general food tariffs; meal_prices retains age-based rates.
-- ============================================================
CREATE TABLE food_rates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount BETWEEN 0 AND 100000000),
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('UAH','USD','EUR')),
    billing_period VARCHAR(10) NOT NULL
        CHECK (billing_period IN ('daily','weekly','monthly')),
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_food_rates_valid_from ON food_rates(valid_from);

-- ============================================================
-- 15. TUITION RATES (tuition_validator.js)
-- ============================================================
CREATE TABLE tuition_rates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    amount NUMERIC(12,2) NOT NULL CHECK (amount BETWEEN 0 AND 100000000),
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('UAH','USD','EUR')),
    billing_period VARCHAR(15) NOT NULL
        CHECK (billing_period IN ('monthly','quarterly','yearly','one_time')),
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_tuition_rates_valid_from ON tuition_rates(valid_from);

-- ============================================================
-- 16. INVOICES (invoice_validator.js)
-- ============================================================
CREATE TABLE invoices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    child_id BIGINT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
        CHECK (currency IN ('UAH','USD','EUR')),
    tuition_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (tuition_amount >= 0),
    meal_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (meal_amount >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),
    total_amount NUMERIC(12,2) GENERATED ALWAYS AS
        (tuition_amount + meal_amount - discount_amount) STORED,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','issued','paid','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start),
    CHECK (JSONB_TYPEOF(parameters) = 'object'),
    CHECK (discount_amount <= tuition_amount)
);
CREATE INDEX idx_invoices_child_id ON invoices(child_id);
CREATE INDEX idx_invoices_period_start ON invoices(period_start);

-- ============================================================
-- 17. PAYMENTS (payment_validator.js)
-- ============================================================
CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date TIMESTAMPTZ NOT NULL,
    method VARCHAR(20) NOT NULL
        CHECK (method IN ('cash','card','bank_transfer','online')),
    transaction_id VARCHAR(200) UNIQUE,
    currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
        CHECK (currency IN ('UAH','USD','EUR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);

-- ============================================================
-- 18. SALARIES (salary_validator.js)
-- ============================================================
CREATE TABLE salaries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    base_salary NUMERIC(12,2) NOT NULL CHECK (base_salary >= 0),
    bonus NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
    deductions NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
    net_salary NUMERIC(12,2) GENERATED ALWAYS AS
        (base_salary + bonus - deductions) STORED,
    currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
        CHECK (currency IN ('UAH','USD','EUR')),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start),
    CHECK (deductions <= base_salary + bonus),
    CHECK (JSONB_TYPEOF(parameters) = 'object')
);
CREATE INDEX idx_salaries_employee_id ON salaries(employee_id);
CREATE INDEX idx_salaries_period_start ON salaries(period_start);

-- ============================================================
-- 19. EXPENSES (expense_validator.js)
-- ============================================================
CREATE TABLE expenses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    amount NUMERIC(12,2) NOT NULL
        CHECK (amount > 0 AND amount <= 100000000),
    date DATE NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN (
        'food','salary','utilities','equipment','education',
        'transport','maintenance','other'
    )),
    description VARCHAR(1000),
    currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
        CHECK (currency IN ('UAH','USD','EUR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category);

-- ============================================================
-- 20. SETTINGS (settings_validator.js)
-- ============================================================
CREATE TABLE settings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    institution_name VARCHAR(150) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    educational_year VARCHAR(9) NOT NULL
        CHECK (educational_year ~ '^[0-9]{4}-[0-9]{4}$'),
    currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
        CHECK (currency IN ('UAH','USD','EUR')),
    timezone VARCHAR(100) NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (CAST(SUBSTRING(educational_year FROM 6 FOR 4) AS INT) =
           CAST(SUBSTRING(educational_year FROM 1 FOR 4) AS INT) + 1),
    CHECK (JSONB_TYPEOF(settings) = 'object')
);

-- auth_validator.js validates login requests against users; it does NOT
-- require a separate auth table. Password hashing/verification is mandatory.
-- report_validator.js validates SELECT/report query arguments against children,
-- employees, groups, invoices, payments, expenses, salaries, etc.; it does
-- NOT require a separate reports table.
--
-- IMPORTANT API CONTRACT MAPPINGS (not automatic in plain SQL):
-- child.name -> children.first_name; surname -> last_name;
-- birthday -> date_of_birth.
-- parent.name -> parents.first_name; surname -> last_name.
-- employee.firstName -> employees.first_name; lastName -> last_name.
-- group.min_age/max_age (equal) -> groups.age_years; the controller must
-- supply an available room_id, and children_count is computed via COUNT().
-- room.name -> rooms.name; the original room_number remains supported.
-- schedule.date + startTime/endTime -> timestamptz start_time/end_time;
-- schedule.employeeId -> teacher_id, subjectId -> subject_id.
-- subject.employeeIds -> rows in employee_subjects.
-- users.password -> a securely derived password_hash (NEVER store plaintext).
-- All other camelCase payload keys -> equivalent snake_case column names.
-- Controllers adapt payload names and call SQL functions. PostgreSQL SQL
-- functions/triggers must enforce domain rules: permissions, group age and
-- capacity, schedule conflicts, tariff policy and payment/accounting totals.
