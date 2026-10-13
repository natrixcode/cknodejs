import express from 'express';
import { pool } from './config/database.js';

const app = express();

app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({
      status: 'error',
      database: 'unavailable',
    });
  }
});

export default app;