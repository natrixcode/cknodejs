
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

test('Children and groups SQL business logic', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB,
  timeout: 120000,
}, async (t) => {
  const dbName = `cknodejs_children_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
  });

  let db;
  let created = false;
  let connected = false;

  try {
    await admin.connect();
    connected = true;

    await admin.query(`CREATE DATABASE "${dbName}"`);
    created = true;

    await execFileAsync(process.execPath, [migrate], {
      env: { ...process.env, PGDATABASE: dbName },
      timeout: 30000,
    });

    db = new Client({ database: dbName });
    await db.connect();

    async function rollback(action) {
      await db.query('BEGIN');
      try {
        await action();
      } finally {
        await db.query('ROLLBACK');
      }
    }

    async function createGroup(
      suffix = 'A',
      capacity = 2,
      age = 3,
      roomCapacity = 2
    ) {
      const room = await db.query(
        `INSERT INTO rooms (name, capacity)
         VALUES ($1, $2) RETURNING id`,
        [`Test Room ${suffix}`, roomCapacity]
      );

      const group = await db.query(
        `INSERT INTO groups
          (name, room_id, age_years, max_capacity)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [`Test Group ${suffix}`, room.rows[0].id, age, capacity]
      );

      return group.rows[0].id;
    }

    async function createChild(suffix = 'A', years = 3) {
      const result = await db.query(
        `INSERT INTO children
          (first_name, last_name, date_of_birth)
         VALUES (
           'Test',
           $1,
           (CURRENT_DATE - ($2::int * INTERVAL '1 year'))::date
         )
         RETURNING id`,
        [suffix, years]
      );

      return result.rows[0].id;
    }

    await t.test('1. Calculate child age', async () => {
      const result = await db.query(
        `SELECT calculate_child_age(
          DATE '2022-11-01',
          DATE '2026-10-27'
        ) AS age`
      );

      assert.equal(result.rows[0].age, 3);
    });

    await t.test('2. Valid group assignment', async () => {
      await rollback(async () => {
        const groupId = await createGroup();
        const childId = await createChild();

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [childId, groupId]
        );

        const result = await db.query(
          'SELECT group_id FROM children WHERE id = $1',
          [childId]
        );

        assert.equal(result.rows[0].group_id, groupId);

        const capacity = await db.query(
          'SELECT * FROM check_group_capacity($1)',
          [groupId]
        );

        assert.equal(Number(capacity.rows[0].children_count), 1);
        assert.equal(capacity.rows[0].free_places, 1);
      });
    });

    await t.test('3. Reject child younger than 2', async () => {
      await rollback(async () => {
        await assert.rejects(
          createChild('Young', 1),
          /KMS_CHILD_AGE_OUT_OF_RANGE/
        );
      });
    });

    await t.test('4. Reject child older than 5', async () => {
      await rollback(async () => {
        await assert.rejects(
          createChild('Old', 6),
          /KMS_CHILD_AGE_OUT_OF_RANGE/
        );
      });
    });

    await t.test('5. Reject age mismatch', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A', 2, 4);
        const childId = await createChild('A', 3);

        await assert.rejects(
          db.query(
            'SELECT assign_child_to_group($1, $2)',
            [childId, groupId]
          ),
          /KMS_CHILD_AGE_MISMATCH/
        );
      });
    });

    await t.test('6. Reject full group', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A', 1);
        const first = await createChild('First');
        const second = await createChild('Second');

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [first, groupId]
        );

        await assert.rejects(
          db.query(
            'SELECT assign_child_to_group($1, $2)',
            [second, groupId]
          ),
          /KMS_GROUP_FULL/
        );
      });
    });

    await t.test('7. Transfer and remove child', async () => {
      await rollback(async () => {
        const firstGroup = await createGroup('A');
        const secondGroup = await createGroup('B');
        const childId = await createChild();

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [childId, firstGroup]
        );

        await db.query(
          'SELECT transfer_child_to_group($1, $2)',
          [childId, secondGroup]
        );

        const transferred = await db.query(
          'SELECT group_id FROM children WHERE id = $1',
          [childId]
        );

        assert.equal(transferred.rows[0].group_id, secondGroup);

        await db.query(
          'SELECT remove_child_from_group($1)',
          [childId]
        );

        const removed = await db.query(
          'SELECT group_id FROM children WHERE id = $1',
          [childId]
        );

        assert.equal(removed.rows[0].group_id, null);
      });
    });

    await t.test('8. Reject group larger than room', async () => {
      await rollback(async () => {
        await assert.rejects(
          createGroup('A', 2, 3, 1),
          /KMS_GROUP_EXCEEDS_ROOM_CAPACITY/
        );
      });
    });


    await t.test('9. Reject duplicate assignment', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A');
        const childId = await createChild();

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [childId, groupId]
        );

        await assert.rejects(
          db.query(
            'SELECT assign_child_to_group($1, $2)',
            [childId, groupId]
          ),
          /KMS_CHILD_ALREADY_ASSIGNED/
        );
      });
    });

    await t.test('10. Reject invalid age change', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A');
        const childId = await createChild();

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [childId, groupId]
        );

        await assert.rejects(
          db.query(
            `UPDATE children
             SET date_of_birth =
               (CURRENT_DATE - INTERVAL '4 years')::date
             WHERE id = $1`,
            [childId]
          ),
          /KMS_CHILD_AGE_MISMATCH/
        );
      });
    });

    await t.test('11. Reject capacity reduction', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A');
        const first = await createChild('First');
        const second = await createChild('Second');

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [first, groupId]
        );

        await db.query(
          'SELECT assign_child_to_group($1, $2)',
          [second, groupId]
        );

        await assert.rejects(
          db.query(
            'UPDATE groups SET max_capacity = 1 WHERE id = $1',
            [groupId]
          ),
          /KMS_GROUP_CAPACITY_BELOW_OCCUPANCY/
        );
      });
    });

    await t.test('12. Reject unavailable assigned room', async () => {
      await rollback(async () => {
        const groupId = await createGroup('A');

        await assert.rejects(
          db.query(
            `UPDATE rooms
             SET status = 'maintenance'
             WHERE id = (
               SELECT room_id FROM groups WHERE id = $1
             )`,
            [groupId]
          ),
          /KMS_ASSIGNED_ROOM_CANNOT_CHANGE/
        );
      });
    });


    await t.test('13. Concurrent assignment respects capacity', async () => {
      const groupId = await createGroup('Concurrent', 1, 3, 1);
      const firstChild = await createChild('ConcurrentFirst');
      const secondChild = await createChild('ConcurrentSecond');

      const clientA = new Client({ database: dbName });
      const clientB = new Client({ database: dbName });

      try {
        await Promise.all([
          clientA.connect(),
          clientB.connect(),
        ]);

        const results = await Promise.allSettled([
          clientA.query(
            'SELECT assign_child_to_group($1, $2)',
            [firstChild, groupId]
          ),
          clientB.query(
            'SELECT assign_child_to_group($1, $2)',
            [secondChild, groupId]
          ),
        ]);

        const successful = results.filter(
          (result) => result.status === 'fulfilled'
        );

        const rejected = results.filter(
          (result) => result.status === 'rejected'
        );

        assert.equal(successful.length, 1);
        assert.equal(rejected.length, 1);

        assert.match(
          rejected[0].reason.message,
          /KMS_GROUP_FULL/
        );

        const count = await db.query(
          'SELECT COUNT(*)::int AS total FROM children WHERE group_id = $1',
          [groupId]
        );

        assert.equal(count.rows[0].total, 1);
      } finally {
        await Promise.allSettled([
          clientA.end(),
          clientB.end(),
        ]);
      }
    });


  } finally {
    await db?.end();

    if (created) {
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    }

    if (connected) {
      await admin.end();
    }
  }
});
