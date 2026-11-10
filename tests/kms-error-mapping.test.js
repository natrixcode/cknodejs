
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationsDir = join(projectRoot, 'database', 'migrations');
const errorHandlerPath = join(
  projectRoot,
  'src',
  'middleware',
  'errorHandler.js'
);

test('Every KMS SQL error has an HTTP error handler mapping', async () => {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'));

  const sqlErrors = new Set();

  for (const file of migrationFiles) {
    const content = await readFile(
      join(migrationsDir, file),
      'utf8'
    );

    const matches = content.matchAll(
      /RAISE\s+EXCEPTION\s+'(KMS_[A-Z0-9_]+)'/gi
    );

    for (const match of matches) {
      sqlErrors.add(match[1]);
    }
  }

  const handlerSource = await readFile(errorHandlerPath, 'utf8');

  const businessErrorsMatch = handlerSource.match(
    /const businessErrors\s*=\s*\{([\s\S]*?)\};/
  );

  const configurationErrorsMatch = handlerSource.match(
    /const configurationErrors\s*=\s*new Set\(\[([\s\S]*?)\]\);/
  );

  assert.ok(
    businessErrorsMatch,
    'Could not find businessErrors mapping in errorHandler.js'
  );

  assert.ok(
    configurationErrorsMatch,
    'Could not find configurationErrors mapping in errorHandler.js'
  );

  const mappedErrors = new Set();

  for (const match of businessErrorsMatch[1].matchAll(
    /\b(KMS_[A-Z0-9_]+)\s*:/g
  )) {
    mappedErrors.add(match[1]);
  }

  for (const match of configurationErrorsMatch[1].matchAll(
    /'(KMS_[A-Z0-9_]+)'/g
  )) {
    mappedErrors.add(match[1]);
  }

  const missingErrors = [...sqlErrors].filter(
    (code) => !mappedErrors.has(code)
  );

  assert.deepEqual(
    missingErrors,
    [],
    `These SQL errors have no mapping in errorHandler.js: ${missingErrors.join(', ')}`
  );
});
