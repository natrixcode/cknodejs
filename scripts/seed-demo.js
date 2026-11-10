import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Demo seed is disabled in production'
    );
  }

  const sql = await readFile(
    new URL('../database/seeds/demo.sql', import.meta.url),
    'utf8'
  );

  await pool.query(sql);

  console.log('Demo seed applied successfully.');
}

try {
  await main();
} catch (error) {
  console.error('Demo seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
