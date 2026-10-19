-- Migration 001: Initial Database Schema for Kindergarten Management System

-- 1. Таблиця приміщень (rooms)
CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Таблиця груп (groups)
CREATE TABLE IF NOT EXISTS groups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    room_id BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
    max_capacity INTEGER NOT NULL CHECK (max_capacity > 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Таблиця дітей (children)
CREATE TABLE IF NOT EXISTS children (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    date_of_birth DATE NOT NULL CHECK (date_of_birth < CURRENT_DATE),
    group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Таблиця батьків / опікунів (parents)
CREATE TABLE IF NOT EXISTS parents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Проміжна таблиця зв'язку багато-до-багатьох: Діти <-> Батьки (children_parents)
CREATE TABLE IF NOT EXISTS children_parents (
    child_id BIGINT REFERENCES children(id) ON DELETE CASCADE,
    parent_id BIGINT REFERENCES parents(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) DEFAULT 'parent',
    PRIMARY KEY (child_id, parent_id)
);

-- 6. Таблиця працівників (employees)
CREATE TABLE IF NOT EXISTS employees (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    position VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Індекси для прискорення часто використовуваних вибірок
CREATE INDEX IF NOT EXISTS idx_children_group_id ON children(group_id);
CREATE INDEX IF NOT EXISTS idx_children_last_name ON children(last_name);
CREATE INDEX IF NOT EXISTS idx_groups_room_id ON groups(room_id);