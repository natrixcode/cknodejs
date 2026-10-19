
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function findJsFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findJsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path);
    }
  }

  return files;
}

const files = await findJsFiles('.');

for (const file of files) {
  console.log(`Checking ${file}`);

  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });

  if (result.error || result.status !== 0) {
    console.error(`Syntax check failed: ${file}`);
    process.exit(1);
  }
}

console.log(`Successfully checked ${files.length} JavaScript files.`);
