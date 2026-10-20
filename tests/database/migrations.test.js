import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';
import { readMigrations } from '../../src/database/migrations.js';

const cli = fileURLToPath(new URL('../../src/database/migrate.js', import.meta.url));

async function directoryFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cknodejs-migration-tests-'));
  t.after(async () => {
    // Видаляємо тільки створену цим тестом тимчасову папку.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cknodejs-migration-tests-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function runCli(database, directory, extraEnv = {}) {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [cli, '--directory', directory], {
      env: { ...process.env, ...extraEnv, PGDATABASE: database },
      timeout: 20000,
      killSignal: 'SIGKILL',
    }, (error, stdout, stderr) => {
      resolveResult({ code: error?.code ?? 0, signal: error?.signal, stdout, stderr });
    });
  });
}

function succeeded(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
}

test('migration files: empty directory, .gitkeep, numeric order and exact SHA-256', async (t) => {
  const directory = await directoryFor(t);
  assert.deepEqual(await readMigrations(directory), []);
  await writeFile(join(directory, '.gitkeep'), '');
  assert.deepEqual(await readMigrations(directory), []);
  const sql = '-- UTF-8: перевірка\r\nSELECT 1;\r\n';
  await writeFile(join(directory, '0010_later.sql'), 'SELECT 2;');
  await writeFile(join(directory, '0002_first.sql'), sql);
  const files = await readMigrations(directory);
  assert.deepEqual(files.map((file) => file.number), [2, 10]);
  assert.equal(files[0].sql, sql);
  assert.equal(files[0].checksum, createHash('sha256').update(sql).digest('hex'));
});

test('migration files: reject duplicate numbers and invalid names before connecting', async (t) => {
  const directory = await directoryFor(t);
  await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;');
  await writeFile(join(directory, '0001_duplicate.sql'), 'SELECT 2;');
  await assert.rejects(readMigrations(directory), /Duplicate migration number 0001/);
  await rm(join(directory, '0001_duplicate.sql'));
  for (const filename of ['1_short.sql', '0000_zero.sql', '0002.sql', 'README.md']) {
    await writeFile(join(directory, filename), 'SELECT 1;');
    const result = await runCli('unused', directory, { PGHOST: '127.0.0.1', PGPORT: '1' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid migration entry/);
    await rm(join(directory, filename));
  }
});

test('CLI connection errors have a nonzero exit code and do not expose passwords', async (t) => {
  const directory = await directoryFor(t);
  const secret = 'password-that-must-not-appear';
  const result = await runCli('unused', directory, {
    PGHOST: '127.0.0.1', PGPORT: '1', PGPASSWORD: secret,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Migration run failed/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});

// Опція вмикає справжні інтеграційні тести. З'єднання з admin DB потрібне
// виключно для CREATE/DROP нових БД з випадковими, контрольованими назвами.
test('PostgreSQL integration', {
  skip: !process.env.MIGRATION_TEST_ADMIN_DB && 'Set MIGRATION_TEST_ADMIN_DB to enable PostgreSQL tests',
  timeout: 120000,
}, async (t) => {
  const admin = new Client({
    database: process.env.MIGRATION_TEST_ADMIN_DB,
    connectionTimeoutMillis: 3000,
  });
  await admin.connect();
  t.after(() => admin.end());

  async function databaseFor(subtest) {
    const name = `cknodejs_migration_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(name, /^cknodejs_migration_test_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE "${name}"`);
    let client;
    // Cleanup реєструється тільки після успішного CREATE DATABASE.
    subtest.after(async () => {
      await client?.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    });
    client = new Client({ database: name, connectionTimeoutMillis: 3000 });
    await client.connect();
    client.on('error', () => {});
    return { name, client, directory: await directoryFor(subtest) };
  }

  async function history(client) {
    return (await client.query('SELECT * FROM public.schema_migrations ORDER BY number')).rows;
  }

  await t.test('empty folder and .gitkeep create only the service table', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    succeeded(await runCli(name, directory));
    await writeFile(join(directory, '.gitkeep'), '');
    succeeded(await runCli(name, directory));
    assert.deepEqual(await history(client), []);
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    assert.deepEqual(rows, [{ tablename: 'schema_migrations' }]);
  });

  await t.test('numeric order, journal metadata, idempotent repeat and connection cleanup', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    await writeFile(join(directory, '0010_insert.sql'), "INSERT INTO migration_probe VALUES (42);");
    await writeFile(join(directory, '0002_create.sql'), 'CREATE TABLE migration_probe (value integer PRIMARY KEY);');
    succeeded(await runCli(name, directory));
    const firstHistory = await history(client);
    assert.deepEqual(firstHistory.map((row) => row.number), [2, 10]);
    for (const row of firstHistory) {
      const bytes = await readFile(join(directory, row.filename));
      assert.equal(row.checksum, createHash('sha256').update(bytes).digest('hex'));
      assert.ok(row.executed_at instanceof Date);
    }
    const repeat = await runCli(name, directory);
    succeeded(repeat);
    assert.match(repeat.stdout, /0 applied, 2 already applied/);
    assert.deepEqual(await history(client), firstHistory);
    assert.deepEqual((await client.query('SELECT * FROM migration_probe')).rows, [{ value: 42 }]);
    const sessions = await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'cknodejs-migrations'");
    assert.equal(sessions.rows[0].count, 0);
  });

  await t.test('unapplied number below the highest applied number blocks all new migrations', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    await writeFile(join(directory, '0002_create.sql'), 'CREATE TABLE migration_probe (value integer PRIMARY KEY);');
    await writeFile(join(directory, '0010_insert.sql'), 'INSERT INTO migration_probe VALUES (10);');
    succeeded(await runCli(name, directory));
    const originalHistory = await history(client);
    assert.deepEqual(originalHistory.map((row) => row.number), [2, 10]);

    await writeFile(join(directory, '0005_in_between.sql'), 'CREATE TABLE earlier_pending_probe (id integer);');
    await writeFile(join(directory, '0011_new.sql'), 'CREATE TABLE later_pending_probe (id integer);');
    const result = await runCli(name, directory);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Migration order mismatch: 0005_in_between.sql.*highest applied migration 0010/);
    assert.doesNotMatch(result.stdout, /Applying /);
    assert.deepEqual(await history(client), originalHistory);
    assert.deepEqual((await client.query("SELECT to_regclass('earlier_pending_probe') AS earlier, to_regclass('later_pending_probe') AS later")).rows, [{ earlier: null, later: null }]);
    assert.deepEqual((await client.query('SELECT * FROM migration_probe')).rows, [{ value: 10 }]);
  });

  await t.test('failed SQL rolls back DDL and data, preserves earlier files, stops later files', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    await writeFile(join(directory, '0001_success.sql'), 'CREATE TABLE migration_probe (value integer); INSERT INTO migration_probe VALUES (1);');
    await writeFile(join(directory, '0002_failure.sql'), `
      CREATE TABLE rolled_back_probe (id integer);
      INSERT INTO migration_probe VALUES (2);
      DO $body$ BEGIN RAISE EXCEPTION 'private-value-must-not-be-logged'; END; $body$;
    `);
    await writeFile(join(directory, '0003_later.sql'), 'CREATE TABLE later_probe (id integer);');
    const failed = await runCli(name, directory);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /0002_failure.sql failed \[P0001\].*ROLLBACK completed/);
    assert.ok(!failed.stderr.includes('private-value-must-not-be-logged'));
    assert.deepEqual((await client.query('SELECT * FROM migration_probe')).rows, [{ value: 1 }]);
    assert.deepEqual((await client.query("SELECT to_regclass('rolled_back_probe') AS failed, to_regclass('later_probe') AS later")).rows, [{ failed: null, later: null }]);
    assert.deepEqual((await history(client)).map((row) => row.number), [1]);
    // Невиконаний файл можна виправити; lock після помилки вже звільнено.
    await writeFile(join(directory, '0002_failure.sql'), 'INSERT INTO migration_probe VALUES (2);');
    succeeded(await runCli(name, directory));
    assert.equal((await history(client)).length, 3);
  });

  await t.test('journal insertion failure rolls back the migration SQL too', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    await writeFile(join(directory, '0001_conflict.sql'), `
      CREATE TABLE rolled_back_probe (id integer);
      INSERT INTO public.schema_migrations (number, filename, checksum)
      VALUES (1, '0001_conflict.sql', repeat('0', 64));
    `);
    const result = await runCli(name, directory);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /23505/);
    assert.deepEqual(await history(client), []);
    assert.equal((await client.query("SELECT to_regclass('rolled_back_probe') AS name")).rows[0].name, null);
  });

  for (const change of ['changed', 'deleted', 'renamed']) {
    await t.test(`${change} applied file blocks all new migrations`, async (subtest) => {
      const { name, client, directory } = await databaseFor(subtest);
      const file = join(directory, '0001_original.sql');
      await writeFile(file, 'SELECT 1;');
      succeeded(await runCli(name, directory));
      const originalHistory = await history(client);
      await writeFile(join(directory, '0002_pending.sql'), 'CREATE TABLE must_not_exist (id integer);');
      if (change === 'changed') await writeFile(file, 'SELECT 1; -- changed bytes');
      if (change === 'deleted') await rm(file);
      if (change === 'renamed') await rename(file, join(directory, '0001_renamed.sql'));
      const result = await runCli(name, directory);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Migration history mismatch/);
      assert.deepEqual(await history(client), originalHistory);
      assert.equal((await client.query("SELECT to_regclass('must_not_exist') AS name")).rows[0].name, null);
    });
  }

  await t.test('whole SQL files support dollar-quoted functions, triggers and constraints', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    await writeFile(join(directory, '0001_trigger.sql'), `
      CREATE TABLE migration_probe (value text NOT NULL CHECK (length(value) > 0));
      CREATE FUNCTION normalize_probe() RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        NEW.value := upper(NEW.value);
        NEW.value := NEW.value || ';TRIGGER';
        RETURN NEW;
      END;
      $function$;
      CREATE TRIGGER normalize_probe BEFORE INSERT ON migration_probe
        FOR EACH ROW EXECUTE FUNCTION normalize_probe();
      INSERT INTO migration_probe VALUES ('test');
    `);
    succeeded(await runCli(name, directory));
    assert.deepEqual((await client.query('SELECT * FROM migration_probe')).rows, [{ value: 'TEST;TRIGGER' }]);
    await assert.rejects(client.query("UPDATE migration_probe SET value = ''"), { code: '23514' });
  });

  await t.test('two real CLI processes cannot migrate simultaneously', async (subtest) => {
    const { name, client, directory } = await databaseFor(subtest);
    const gateKey = [123456789, 9876];
    await client.query('SELECT pg_advisory_lock($1, $2)', gateKey);
    await writeFile(join(directory, '0001_concurrent.sql'), `
      CREATE TABLE migration_probe (value integer);
      SELECT pg_advisory_xact_lock(${gateKey[0]}, ${gateKey[1]});
      INSERT INTO migration_probe VALUES (1);
    `);
    const first = runCli(name, directory);
    try {
      const deadline = Date.now() + 10000;
      let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await client.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'cknodejs-migrations' AND wait_event = 'advisory'");
        if (rows.length) { waiting = true; break; }
        await delay(25);
      }
      assert.ok(waiting, 'First process must hold the migration lock and wait on the test gate');
      const second = await runCli(name, directory);
      assert.equal(second.code, 1);
      assert.match(second.stderr, /Another migration process is running/);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', gateKey);
      succeeded(await first);
    }
    succeeded(await runCli(name, directory));
    assert.equal((await history(client)).length, 1);
    assert.deepEqual((await client.query('SELECT * FROM migration_probe')).rows, [{ value: 1 }]);
  });
});
