import { pool } from '../src/config/database.js';
import { hashPassword } from '../src/utils/password.js';

const accounts = [
  {
    username: 'demo_manager',
    name: 'Demo Manager',
    role: 'manager'
  },
  {
    username: 'demo_educator',
    name: 'Demo Educator',
    role: 'employee',
    employeeEmail: 'demo.educator1@example.test'
  },
  {
    username: 'demo_assistant',
    name: 'Demo Assistant',
    role: 'employee',
    employeeEmail: 'demo.assistant1@example.test'
  },
  {
    username: 'demo_teacher',
    name: 'Demo Teacher',
    role: 'teacher',
    employeeEmail: 'demo.teacher@example.test'
  },
  {
    username: 'demo_parent',
    name: 'Demo Parent',
    role: 'parent',
    parentEmail: 'demo.parent1@example.test'
  }
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo accounts are disabled in production');
  }

  const password = process.env.DEMO_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error('Set DEMO_PASSWORD (at least 12 characters)');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(2026, 5005)');

    for (const account of accounts) {
      const existing = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [account.username]
      );

      if (existing.rowCount > 0) {
        console.log(`Already exists: ${account.username}`);
        continue;
      }

      let employeeId = null;
      let parentId = null;

      if (account.employeeEmail) {
        const result = await client.query(
          'SELECT id FROM employees WHERE email = $1',
          [account.employeeEmail]
        );

        if (result.rowCount !== 1) {
          throw new Error(`Missing employee: ${account.employeeEmail}`);
        }

        employeeId = result.rows[0].id;
      }

      if (account.parentEmail) {
        const result = await client.query(
          'SELECT id FROM parents WHERE email = $1',
          [account.parentEmail]
        );

        if (result.rowCount !== 1) {
          throw new Error(`Missing parent: ${account.parentEmail}`);
        }

        parentId = result.rows[0].id;
      }

      const passwordHash = await hashPassword(password);

      await client.query(
        `INSERT INTO users (
          username, name, password_hash, role,
          parent_id, employee_id, status, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'active', TRUE)`,
        [
          account.username,
          account.name,
          passwordHash,
          account.role,
          parentId,
          employeeId
        ]
      );

      console.log(`Created: ${account.username}`);
    }

    await client.query('COMMIT');
    console.log('Demo accounts ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  console.error('Demo accounts failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
