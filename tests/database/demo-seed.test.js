import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/config/database.js';

test('Demo seed contains required data', {
  skip: process.env.RUN_DEMO_SEED_TEST !== "true"
    ? "Demo seed test requires prepared demo database"
    : false
}, async () => {
  const checks = [
    {
      table: 'rooms',
      column: 'name',
      values: ['Demo Room A', 'Demo Room B']
    },
    {
      table: 'groups',
      column: 'name',
      values: ['Demo Group 3', 'Demo Group 4']
    },
    {
      table: 'employees',
      column: 'email',
      values: [
        'demo.educator1@example.test',
        'demo.assistant1@example.test',
        'demo.educator2@example.test',
        'demo.assistant2@example.test',
        'demo.teacher@example.test'
      ]
    },
    {
      table: 'parents',
      column: 'email',
      values: [
        'demo.parent1@example.test',
        'demo.parent2@example.test'
      ]
    },
    {
      table: 'users',
      column: 'username',
      values: [
        'demo_manager',
        'demo_educator',
        'demo_assistant',
        'demo_teacher',
        'demo_parent'
      ]
    }
  ];

  for (const check of checks) {
    const result = await pool.query(
      `SELECT ${check.column}
       FROM ${check.table}
       WHERE ${check.column} = ANY($1::text[])`,
      [check.values]
    );

    assert.equal(
      result.rowCount,
      check.values.length,
      `Missing demo data in ${check.table}`
    );
  }
});
