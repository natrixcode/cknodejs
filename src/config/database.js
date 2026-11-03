import pg, { Pool } from 'pg';

// DATE повертаємо як рядок YYYY-MM-DD. Інакше pg створює Date
// у часовому поясі сервера, і в Києві дата зсувається на день назад.
pg.types.setTypeParser(pg.types.builtins.DATE, value => value);

// pg читає PGHOST, PGPORT, PGDATABASE, PGUSER і PGPASSWORD із середовища.
export const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
  statement_timeout: 3000,
  query_timeout: 4000,
});

// Втрата вже відкритого з'єднання не повинна завершувати сервер.
pool.on('error', () => {
  console.error('Database connection is unavailable.');
});
