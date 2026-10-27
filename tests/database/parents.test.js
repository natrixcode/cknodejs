
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);
const migrate = fileURLToPath(
  new URL('../../src/database/migrate.js', import.meta.url)
);

test('Parents SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB &&
    'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const dbName =
    `cknodejs_parents_test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });

  let db;
  let connected = false;
  let created = false;
  let counter = 0;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    db = new Client({
      database: dbName,
      connectionTimeoutMillis: 3000,
    });

    await db.connect();

    async function rollback(action) {
      await db.query('BEGIN');

      try {
        await action();
      } finally {
        await db.query('ROLLBACK');
      }
    }

    async function createChild() {
      const result = await db.query(`
        INSERT INTO children
          (first_name, last_name, date_of_birth)
        VALUES (
          'Test',
          'Child',
          (CURRENT_DATE - INTERVAL '3 years')::date
        )
        RETURNING id
      `);

      return result.rows[0].id;
    }

    async function createParent() {
      const n = ++counter;

      const result = await db.query(`
        INSERT INTO parents
          (first_name, last_name, phone, email)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        'Test',
        `Parent${n}`,
        `380500${String(n).padStart(6, '0')}`,
        `parent${n}@example.test`,
      ]);

      return result.rows[0].id;
    }

    async function link(childId, parentId, relationship = 'parent') {
      return db.query(
        'SELECT kms_link_parent_to_child($1, $2, $3)',
        [childId, parentId, relationship]
      );
    }

    await t.test('1. Link parent to child', async () => {
      await rollback(async () => {
        const child = await createChild();
        const parent = await createParent();

        await link(child, parent);

        const result = await db.query(
          `SELECT * FROM kms_get_child_parents($1)`,
          [child]
        );

        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].parent_id, parent);
        assert.equal(result.rows[0].relationship_type, 'parent');
      });
    });

    await t.test('2. Update existing relationship', async () => {
      await rollback(async () => {
        const child = await createChild();
        const parent = await createParent();

        await link(child, parent);
        await link(child, parent, 'guardian');

        const result = await db.query(
          `SELECT relationship_type
           FROM children_parents
           WHERE child_id = $1 AND parent_id = $2`,
          [child, parent]
        );

        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].relationship_type, 'guardian');
      });
    });

    await t.test('3. Many-to-many relationships', async () => {
      await rollback(async () => {
        const child1 = await createChild();
        const child2 = await createChild();
        const parent1 = await createParent();
        const parent2 = await createParent();

        await link(child1, parent1);
        await link(child1, parent2);
        await link(child2, parent1);

        const parents = await db.query(
          'SELECT * FROM kms_get_child_parents($1)',
          [child1]
        );

        const children = await db.query(
          'SELECT * FROM kms_get_parent_children($1)',
          [parent1]
        );

        assert.equal(parents.rows.length, 2);
        assert.equal(children.rows.length, 2);
      });
    });

    await t.test('4. Unlink parent from child', async () => {
      await rollback(async () => {
        const child = await createChild();
        const parent = await createParent();

        await link(child, parent);

        await db.query(
          'SELECT kms_unlink_parent_from_child($1, $2)',
          [child, parent]
        );

        const result = await db.query(
          'SELECT * FROM kms_get_child_parents($1)',
          [child]
        );

        assert.equal(result.rows.length, 0);
      });
    });

    await t.test('5. Reject unlink of missing link', async () => {
      await rollback(async () => {
        const child = await createChild();
        const parent = await createParent();

        await assert.rejects(
          db.query(
            'SELECT kms_unlink_parent_from_child($1, $2)',
            [child, parent]
          ),
          /KMS_PARENT_LINK_NOT_FOUND/
        );
      });
    });

    await t.test('6. Reject invalid relationship data', async () => {
      for (const relationship of ['', '   ', null]) {
        await rollback(async () => {
          const child = await createChild();
          const parent = await createParent();

          await assert.rejects(
            db.query(
              'SELECT kms_link_parent_to_child($1, $2, $3)',
              [child, parent, relationship]
            ),
            /KMS_INVALID_PARENT_LINK/
          );
        });
      }
    });

    await t.test('7. Reject nonexistent child or parent', async () => {
      await rollback(async () => {
        const child = await createChild();

        await assert.rejects(
          link(child, -1),
          { code: '23503' }
        );
      });

      await rollback(async () => {
        const parent = await createParent();

        await assert.rejects(
          link(-1, parent),
          { code: '23503' }
        );
      });
    });

    await t.test('8. Add child relative', async () => {
      await rollback(async () => {
        const child = await createChild();

        await db.query(
          `SELECT kms_add_relative($1, $2, $3, $4, $5)`,
          [
            child,
            '  Anna Test  ',
            'grandmother',
            'Retired',
            'Emergency contact',
          ]
        );

        const result = await db.query(
          'SELECT * FROM child_relatives WHERE child_id = $1',
          [child]
        );

        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].full_name, 'Anna Test');
        assert.equal(result.rows[0].relationship_type, 'grandmother');
        assert.equal(result.rows[0].occupation, 'Retired');
      });
    });

    await t.test('9. Reject invalid relative', async () => {
      for (const [name, relationship] of [
        ['', 'grandmother'],
        ['Anna', ''],
        [null, 'grandmother'],
      ]) {
        await rollback(async () => {
          const child = await createChild();

          await assert.rejects(
            db.query(
              'SELECT kms_add_relative($1, $2, $3)',
              [child, name, relationship]
            ),
            /KMS_INVALID_RELATIVE_DATA/
          );
        });
      }
    });

    await t.test('10. Delete child cascades to links', async () => {
      await rollback(async () => {
        const child = await createChild();
        const parent = await createParent();

        await link(child, parent);

        await db.query(
          'SELECT kms_add_relative($1, $2, $3)',
          [child, 'Anna Test', 'grandmother']
        );

        await db.query(
          'DELETE FROM children WHERE id = $1',
          [child]
        );

        const links = await db.query(
          'SELECT * FROM children_parents WHERE child_id = $1',
          [child]
        );

        const relatives = await db.query(
          'SELECT * FROM child_relatives WHERE child_id = $1',
          [child]
        );

        const parents = await db.query(
          'SELECT id FROM parents WHERE id = $1',
          [parent]
        );

        assert.equal(links.rows.length, 0);
        assert.equal(relatives.rows.length, 0);
        assert.equal(parents.rows.length, 1);
      });
    });

  } finally {
    try {
      await db?.end();
    } finally {
      try {
        if (created) {
          await admin.query(
            `DROP DATABASE "${dbName}" WITH (FORCE)`
          );
        }
      } finally {
        if (connected) {
          await admin.end();
        }
      }
    }
  }
});
