import { pool } from '../config/database.js';

export async function getHealth() {
  return { status: 200, body: {
    status: 'ok',
    service: 'cknodejs',
    uptime: process.uptime()
  } };
}

export async function getLiveness() {
  return { status: 200, body: {
    status: 'alive'
  } };
}

export async function getReadiness() {
  try {
    await pool.query('SELECT 1');

    return { status: 200, body: {
      status: 'ready',
      database: 'ok'
    } };
  } catch {
    return { status: 503, body: {
      status: 'not_ready',
      database: 'unavailable'
    } };
  }
}
