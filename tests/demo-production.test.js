import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const scripts = [
  'scripts/seed-demo.js',
  'scripts/seed-demo-users.js'
];

for (const script of scripts) {
  test(`${script} rejects production mode`, () => {
    const result = spawnSync(
      process.execPath,
      [script],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production'
        },
        encoding: 'utf8',
        timeout: 10000
      }
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /disabled in production/
    );
  });
}
