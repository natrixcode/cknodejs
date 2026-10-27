-- 0003: Parents and relatives business logic

CREATE TABLE child_relatives (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    child_id BIGINT NOT NULL
        REFERENCES children(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL
        CHECK (length(btrim(full_name)) > 0),
    relationship_type VARCHAR(50) NOT NULL
        CHECK (length(btrim(relationship_type)) > 0),
    occupation VARCHAR(150),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_child_relatives_child
ON child_relatives(child_id);


-- Прив'язати батька або законного представника
-- до дитини. Повторний виклик оновлює тип зв'язку.

CREATE OR REPLACE FUNCTION kms_link_parent_to_child(
    p_child_id BIGINT,
    p_parent_id BIGINT,
    p_relationship VARCHAR DEFAULT 'parent'
)
RETURNS children_parents
LANGUAGE plpgsql
AS $$
DECLARE
    v_result children_parents%ROWTYPE;
BEGIN
    IF p_child_id IS NULL
       OR p_parent_id IS NULL
       OR p_relationship IS NULL
       OR btrim(p_relationship) = '' THEN
        RAISE EXCEPTION 'KMS_INVALID_PARENT_LINK';
    END IF;

    INSERT INTO children_parents (
        child_id, parent_id, relationship_type
    )
    VALUES (
        p_child_id, p_parent_id, p_relationship
    )
    ON CONFLICT (child_id, parent_id)
    DO UPDATE SET
        relationship_type = EXCLUDED.relationship_type
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Відв'язати батька від дитини

CREATE OR REPLACE FUNCTION kms_unlink_parent_from_child(
    p_child_id BIGINT,
    p_parent_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM children_parents
    WHERE child_id = p_child_id
      AND parent_id = p_parent_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KMS_PARENT_LINK_NOT_FOUND';
    END IF;
END;
$$;


-- Додати інформацію про родича

CREATE OR REPLACE FUNCTION kms_add_relative(
    p_child_id BIGINT,
    p_full_name VARCHAR,
    p_relationship VARCHAR,
    p_occupation VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS child_relatives
LANGUAGE plpgsql
AS $$
DECLARE
    v_result child_relatives%ROWTYPE;
BEGIN
    IF p_full_name IS NULL
       OR btrim(p_full_name) = ''
       OR p_relationship IS NULL
       OR btrim(p_relationship) = '' THEN
        RAISE EXCEPTION 'KMS_INVALID_RELATIVE_DATA';
    END IF;

    INSERT INTO child_relatives (
        child_id, full_name,
        relationship_type, occupation, notes
    )
    VALUES (
        p_child_id,
        btrim(p_full_name),
        btrim(p_relationship),
        p_occupation,
        p_notes
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;


-- Отримати батьків дитини

CREATE OR REPLACE FUNCTION kms_get_child_parents(
    p_child_id BIGINT
)
RETURNS TABLE (
    parent_id BIGINT,
    first_name VARCHAR,
    last_name VARCHAR,
    phone VARCHAR,
    email VARCHAR,
    relationship_type VARCHAR
)
LANGUAGE SQL
STABLE
AS $$
    SELECT
        p.id, p.first_name, p.last_name,
        p.phone, p.email, cp.relationship_type
    FROM parents p
    JOIN children_parents cp ON cp.parent_id = p.id
    WHERE cp.child_id = p_child_id;
$$;


-- Отримати дітей певного батька

CREATE OR REPLACE FUNCTION kms_get_parent_children(
    p_parent_id BIGINT
)
RETURNS SETOF children
LANGUAGE SQL
STABLE
AS $$
    SELECT c.*
    FROM children c
    JOIN children_parents cp ON cp.child_id = c.id
    WHERE cp.parent_id = p_parent_id;
$$;