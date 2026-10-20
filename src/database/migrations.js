import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export const defaultDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url),
);

// Один постійний ключ для всіх процесів міграцій у цій БД.
const lockKey = [0x434b4e4a, 1];

export class MigrationError extends Error {}

// Не виводимо повідомлення PostgreSQL, SQL, параметри підключення чи stack:
// вони можуть містити паролі або значення даних. Код і позиція безпечні.
export function errorDetails(error) {
  const code = /^[A-Z0-9_]+$/.test(error?.code) ? ` [${error.code}]` : '';
  const position = /^\d+$/.test(error?.position) ? `, SQL position ${error.position}` : '';
  return `${code}${position}`;
}

export async function readMigrations(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new MigrationError(`Cannot read migrations directory.${errorDetails(error)}`);
  }

  const migrations = [];
  const numbers = new Set();
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue;
    const match = /^([0-9]{4})_[a-z][a-z0-9_]*\.sql$/.exec(entry.name);
    if (!entry.isFile() || !match || Number(match[1]) === 0) {
      throw new MigrationError(
        `Invalid migration entry ${JSON.stringify(entry.name)}. Expected 0001_description.sql (0001–9999, lowercase snake_case).`,
      );
    }
    const number = Number(match[1]);
    if (numbers.has(number)) {
      throw new MigrationError(`Duplicate migration number ${match[1]}.`);
    }
    numbers.add(number);

    let content;
    try {
      content = await readFile(join(directory, entry.name));
    } catch (error) {
      throw new MigrationError(`Cannot read ${entry.name}.${errorDetails(error)}`);
    }
    migrations.push({
      number,
      filename: entry.name,
      checksum: createHash('sha256').update(content).digest('hex'),
      sql: content.toString('utf8'),
    });
  }
  return migrations.sort((a, b) => a.number - b.number);
}

function validateHistory(migrations, history) {
  const files = new Map(migrations.map((migration) => [migration.number, migration]));
  for (const applied of history) {
    const file = files.get(applied.number);
    if (!file) {
      throw new MigrationError(`Migration history mismatch: applied migration ${applied.number} is missing. Restore the original file.`);
    }
    if (file.filename !== applied.filename || file.checksum !== applied.checksum) {
      throw new MigrationError(`Migration history mismatch: ${file.filename} was changed or renamed. Restore the original file; add a new migration for changes.`);
    }
  }
}

export async function runMigrations({
  directory = defaultDirectory,
  signal,
  log = console.log,
} = {}) {
  const migrations = await readMigrations(directory);
  signal?.throwIfAborted();

  // Ті самі PG* змінні, що й у API, але без його коротких тайм-аутів запитів.
  const client = new Client({
    connectionTimeoutMillis: 3000,
    statement_timeout: 0,
    query_timeout: 0,
    application_name: 'cknodejs-migrations',
  });
  let connectionError;
  client.on('error', (error) => { connectionError = error; });
  let closing;
  const close = () => (closing ??= client.end());
  // Закриття сесії також відкочує активну транзакцію і звільняє advisory lock.
  const abort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    await client.connect();
    signal?.throwIfAborted();
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired', lockKey,
    );
    if (!lock.acquired) {
      throw new MigrationError('Another migration process is running. Wait for it to finish and retry.');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        number integer PRIMARY KEY CHECK (number BETWEEN 1 AND 9999),
        filename text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        executed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const { rows: history } = await client.query(
      'SELECT number, filename, checksum FROM public.schema_migrations ORDER BY number',
    );
    // Перевіряємо всю історію до першої нової міграції.
    validateHistory(migrations, history);
    const applied = new Set(history.map((migration) => migration.number));
    const highestAppliedNumber = history.at(-1)?.number ?? 0;
    const outOfOrder = migrations.find(
      (migration) => !applied.has(migration.number) && migration.number < highestAppliedNumber,
    );
    if (outOfOrder) {
      const highest = String(highestAppliedNumber).padStart(4, '0');
      throw new MigrationError(`Migration order mismatch: ${outOfOrder.filename} has a number below the highest applied migration ${highest}. No new migrations were started; assign a new number above ${highest} to the unapplied migration.`);
    }
    let count = 0;

    for (const migration of migrations) {
      signal?.throwIfAborted();
      if (applied.has(migration.number)) {
        log(`Skip ${migration.filename}: already applied.`);
        continue;
      }
      log(`Applying ${migration.filename}...`);
      try {
        await client.query('BEGIN');
        // Передаємо файл цілком: dollar-quoted тіла можуть містити крапки з комою.
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (number, filename, checksum) VALUES ($1, $2, $3)',
          [migration.number, migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        let rollback = 'ROLLBACK completed.';
        try {
          await client.query('ROLLBACK');
        } catch {
          rollback = 'ROLLBACK could not be confirmed; closing the connection. Check database history before retrying.';
        }
        throw new MigrationError(`Migration ${migration.filename} failed${errorDetails(error)}. ${rollback} No later migrations were started.`);
      }
      count += 1;
      log(`Applied ${migration.filename}.`);
    }
    signal?.throwIfAborted();
    if (connectionError) throw connectionError;
    log(`Migrations complete: ${count} applied, ${applied.size} already applied.`);
    return { applied: count, skipped: applied.size };
  } finally {
    signal?.removeEventListener('abort', abort);
    // Сесійний lock діє між COMMIT окремих файлів і звільняється разом із сесією.
    await close();
  }
}
