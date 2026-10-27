import {
  pool, ok, fail
} from './_common.js';

export async function getLiveness() {
  return ok({
    status: 'alive'
  });
}

export async function getReadiness() {
  try {
    await pool.query('SELECT 1');

    return ok({
      status: 'ready',
      database: 'connected'
    });
  } catch {
    return fail(
      503,
      'Database is unavailable'
    );
  }
}

export const getHealth = getReadiness;