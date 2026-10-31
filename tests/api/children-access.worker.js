
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { pool } from '../../src/config/database.js';
import { createSession, revokeSession } from '../../src/utils/sessions.js';

async function main() {
  const database = await pool.query(
    'SELECT current_database() AS name'
  );

  const databaseName = database.rows[0].name;

  if (!databaseName.startsWith('cknodejs_access_test_')) {
    throw new Error('Refusing to test against a non-test database');
  }

  const parentA = await pool.query(
    `INSERT INTO parents (first_name, last_name, phone)
     VALUES ('Parent', 'A', '+380990000101')
     RETURNING id`
  );

  const parentB = await pool.query(
    `INSERT INTO parents (first_name, last_name, phone)
     VALUES ('Parent', 'B', '+380990000102')
     RETURNING id`
  );

  const child = await pool.query(
    `INSERT INTO children (first_name, last_name, date_of_birth)
     VALUES ('Test', 'Child', CURRENT_DATE - INTERVAL '3 years')
     RETURNING id`
  );

  const childId = child.rows[0].id;

  await pool.query(
    `INSERT INTO children_parents (child_id, parent_id)
     VALUES ($1, $2)`,
    [childId, parentA.rows[0].id]
  );

  const users = await pool.query(
    `INSERT INTO users
       (username, password_hash, role, parent_id)
     VALUES
       ('access_admin', 'test-hash', 'admin', NULL),
       ('access_parent_a', 'test-hash', 'parent', $1),
       ('access_parent_b', 'test-hash', 'parent', $2)
     RETURNING id, role`,
    [parentA.rows[0].id, parentB.rows[0].id]
  );

  const [admin, firstParent, secondParent] = users.rows;

  // Create invoice and payment through SQL business functions.
  const invoiceResult = await pool.query(
    `SELECT *
     FROM kms_issue_invoice($1, $2::date, $3, $4)`,
    [childId, '2026-10-01', 1, 5]
  );

  const invoiceId = invoiceResult.rows[0].id;

  const paymentResult = await pool.query(
    `SELECT *
     FROM kms_register_payment($1, $2, 'card', $3)`,
    [invoiceId, 100, 'access-control-test-payment']
  );

  const paymentId = paymentResult.rows[0].id;

  const tokens = [
    createSession(admin.id).token,
    createSession(firstParent.id).token,
    createSession(secondParent.id).token
  ];

  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(method, path, token, body) {
      return fetch(`${baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    }

    const cases = [
      {
        name: 'Admin can view child',
        method: 'GET',
        path: `/children/${childId}`,
        token: tokens[0],
        expected: 200
      },
      {
        name: 'Parent A can view own child',
        method: 'GET',
        path: `/children/${childId}`,
        token: tokens[1],
        expected: 200
      },
      {
        name: 'Parent B cannot view unrelated child',
        method: 'GET',
        path: `/children/${childId}`,
        token: tokens[2],
        expected: 403
      },
      {
        name: 'Parent A cannot update child',
        method: 'PATCH',
        path: `/children/${childId}`,
        token: tokens[1],
        body: { first_name: 'Changed' },
        expected: 403
      },
      {
        name: 'Parent A cannot list all children',
        method: 'GET',
        path: '/children',
        token: tokens[1],
        expected: 403
      },
      
      {
        name: 'Admin can view invoice',
        method: 'GET',
        path: `/invoices/${invoiceId}`,
        token: tokens[0],
        expected: 200
      },
      {
        name: 'Parent A can view own invoice',
        method: 'GET',
        path: `/invoices/${invoiceId}`,
        token: tokens[1],
        expected: 200
      },
      {
        name: 'Parent B cannot view unrelated invoice',
        method: 'GET',
        path: `/invoices/${invoiceId}`,
        token: tokens[2],
        expected: 403
      },
      {
        name: 'Parent A can view own payment',
        method: 'GET',
        path: `/payments/${paymentId}`,
        token: tokens[1],
        expected: 200
      },
      {
        name: 'Parent B cannot view unrelated payment',
        method: 'GET',
        path: `/payments/${paymentId}`,
        token: tokens[2],
        expected: 403
      },
      {
        name: 'Parent A cannot create invoice',
        method: 'POST',
        path: '/invoices',
        token: tokens[1],
        body: {},
        expected: 403
      },
      {
        name: 'Parent A cannot create payment',
        method: 'POST',
        path: '/payments',
        token: tokens[1],
        body: {},
        expected: 403
      }

    ];

    for (const item of cases) {
      const response = await request(
        item.method,
        item.path,
        item.token,
        item.body
      );

      assert.equal(
        response.status,
        item.expected,
        `${item.name}: expected ${item.expected}, got ${response.status}`
      );

      console.log(`PASS: ${item.name}`);
    }
  } finally {
    for (const token of tokens) {
      revokeSession(token);
    }

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
