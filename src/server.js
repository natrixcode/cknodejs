import express from 'express';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`HTTP server is listening on port ${port}.`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: stopping HTTP server.`);

  // Обмежуємо очікування; Compose дає процесу 15 секунд на завершення.
  const timeout = setTimeout(() => {
    console.error('Shutdown timed out.');
    process.exit(1);
  }, 10000);
  timeout.unref();

  // Спочатку завершуємо HTTP-запити, потім закриваємо Pool.
  server.close(async () => {
    try {
      await pool.end();
      console.log('HTTP server stopped; database pool closed.');
    } catch {
      console.error('Could not close database pool.');
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', () => {
  console.error('HTTP server could not start. Check whether its port is in use.');
  process.exitCode = 1;
  shutdown('Server error');
});
