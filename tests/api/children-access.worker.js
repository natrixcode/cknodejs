
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
     ('access_parent_b', 'test-hash', 'parent', $2),
     ('access_manager', 'test-hash', 'manager', NULL)
   RETURNING id, role`,
  [parentA.rows[0].id, parentB.rows[0].id]
);

const [admin, firstParent, secondParent, manager] = users.rows;

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
  createSession(secondParent.id).token,
  createSession(manager.id).token
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
  name: 'Parent A can view own profile',
  method: 'GET',
  path: `/parents/${parentA.rows[0].id}`,
  token: tokens[1],
  expected: 200
},
{
  name: 'Parent B cannot view Parent A profile',
  method: 'GET',
  path: `/parents/${parentA.rows[0].id}`,
  token: tokens[2],
  expected: 403
},
{
  name: 'Parent A can view own children',
  method: 'GET',
  path: `/parents/${parentA.rows[0].id}/children`,
  token: tokens[1],
  expected: 200
},
{
  name: 'Parent A can view own invoices',
  method: 'GET',
  path: `/parents/${parentA.rows[0].id}/invoices`,
  token: tokens[1],
  expected: 200
},
{
  name: 'Parent A can view own payments',
  method: 'GET',
  path: `/parents/${parentA.rows[0].id}/payments`,
  token: tokens[1],
  expected: 200
},
{
  name: 'Parent A can update own phone',
  method: 'PATCH',
  path: `/parents/${parentA.rows[0].id}`,
  token: tokens[1],
  body: { phone: '+380990000999' },
  expected: 200
},
{
  name: 'Parent A cannot update own name',
  method: 'PATCH',
  path: `/parents/${parentA.rows[0].id}`,
  token: tokens[1],
  body: { first_name: 'Changed' },
  expected: 400
},
{
  name: 'Parent B cannot update Parent A',
  method: 'PATCH',
  path: `/parents/${parentA.rows[0].id}`,
  token: tokens[2],
  body: { phone: '+380990000888' },
  expected: 403
},
      {
        name: 'Admin can view child',
        method: 'GET',
        path: `/children/${childId}`,
        token: tokens[0],
        expected: 200
      },
      {
  name: 'Manager can list invoices',
  method: 'GET',
  path: '/invoices',
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager can view invoice',
  method: 'GET',
  path: `/invoices/${invoiceId}`,
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager can view invoice items',
  method: 'GET',
  path: `/invoices/${invoiceId}/items`,
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager cannot create invoice',
  method: 'POST',
  path: '/invoices',
  token: tokens[3],
  body: {},
  expected: 403
},
{
  name: 'Manager cannot cancel invoice',
  method: 'POST',
  path: `/invoices/${invoiceId}/cancel`,
  token: tokens[3],
  body: {},
  expected: 403
},
{
  name: 'Manager can list payments',
  method: 'GET',
  path: '/payments',
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager can view payment',
  method: 'GET',
  path: `/payments/${paymentId}`,
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager can view invoice payments',
  method: 'GET',
  path: `/payments/${invoiceId}/payments`,
  token: tokens[3],
  expected: 200
},
{
  name: 'Manager cannot create payment',
  method: 'POST',
  path: '/payments',
  token: tokens[3],
  body: {},
  expected: 403
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


    // Invalid numeric route IDs must return 400, never 500.
    const invalidIds = [
      'abc',
      '-1',
      '9223372036854775808'
    ];

    const numericIdRoutes = [
      { method: 'GET', path: '/children/:id' },
      { method: 'GET', path: '/daily-blocks/:id' },

      { method: 'GET', path: '/discounts/:id' },
      { method: 'GET', path: '/discounts/:childId/discounts' },
      { method: 'DELETE', path: '/discounts/1/discounts/:discountId' },

      { method: 'GET', path: '/employees/:id' },
      { method: 'GET', path: '/expenses/:id' },
      { method: 'PATCH', path: '/food/rates/:id' },

      { method: 'GET', path: '/groups/:id' },
      { method: 'DELETE', path: '/groups/1/children/:childId' },
      { method: 'DELETE', path: '/groups/1/employees/:employeeId' },

      { method: 'GET', path: '/invoices/:id' },
      { method: 'GET', path: '/parents/:id' },

      { method: 'GET', path: '/payments/:id' },
      { method: 'GET', path: '/payments/:invoiceId/payments' },

      { method: 'GET', path: '/reports/profit/groups/:groupId' },
      { method: 'GET', path: '/rooms/:id' },

      { method: 'GET', path: '/salaries/:id' },
      { method: 'GET', path: '/salaries/:employeeId/salaries' },

      { method: 'GET', path: '/schedule/:id' },
      { method: 'GET', path: '/subjects/:id' },
      { method: 'GET', path: '/tuition/rates/:id' },
      { method: 'GET', path: '/users/:id' }
    ];

    for (const route of numericIdRoutes) {
      for (const invalidId of invalidIds) {
        const path = route.path.replace(
          /:[a-zA-Z][a-zA-Z0-9]*/,
          invalidId
        );

        const response = await request(
          route.method,
          path,
          tokens[0]
        );

        const responseText = await response.text();

        assert.equal(
          response.status,
          400,
          `${route.method} ${path}: expected 400 for invalid ID "${invalidId}", got ${response.status}. Response: ${responseText}`
        );

        assert.doesNotMatch(
          responseText,
          /stack trace|syntax error|postgres|select\s+|insert\s+|update\s+|delete\s+/i,
          `${path}: response must not expose SQL details or stack traces`
        );
      }
    }

    console.log('PASS: Invalid route IDs return 400 without exposing SQL or stack traces');
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
