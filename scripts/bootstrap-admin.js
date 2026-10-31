
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { pool } from '../src/config/database.js';
import { hashPassword } from '../src/utils/password.js';

const LOCK_ID = 741852963;

async function main() {
  const rl = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const username = (await rl.question('Username: ')).trim();
    const name = (await rl.question('Name: ')).trim();
    const email = (await rl.question('Email: ')).trim();
    const password = await rl.question('Password: ');

    if (
      !/^[a-zA-Z0-9_.-]{3,50}$/.test(username) ||
      !name ||
      name.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 100 ||
      password.length < 12
    ) {
      throw new Error('Invalid administrator data');
    }

    const passwordHash = await hashPassword(password);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Prevent two bootstrap processes from creating
      // the first administrator simultaneously.
      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [LOCK_ID]
      );

      const existing = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM users WHERE role = 'admin'
         ) AS exists`
      );

      if (existing.rows[0].exists) {
        throw new Error(
          'Administrator already exists. Bootstrap is disabled.'
        );
      }

      await client.query(
        `INSERT INTO users (
           username,
           name,
           email,
           password_hash,
           role,
           status,
           is_active,
           parent_id,
           employee_id
         )
         VALUES ($1, $2, $3, $4, 'admin',
                 'active', TRUE, NULL, NULL)`,
        [username, name, email, passwordHash]
      );

      await client.query('COMMIT');

      console.log('Administrator created successfully.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    rl.close();
  }
}

try {
  await main();
} catch (error) {
  console.error('Bootstrap failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
