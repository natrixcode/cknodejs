
import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../../src/app.js';
import { pool } from '../../src/config/database.js';

async function startServer() {
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test('GET /users without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/users`);

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('GET /users with invalid token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/users`, {
      headers: {
        Authorization: 'Bearer invalid-token'
      }
    });

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('PATCH /users/:id/role without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/users/1/role`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'admin'
        })
      }
    );

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('POST /users without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Unauthorized User',
        email: 'unauthorized@example.test',
        password: 'TestPassword123',
        role: 'admin'
      })
    });

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});
test('GET /children without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/children`);

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('GET /payments without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/payments`);

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('GET /schedule without token returns 401', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/v1/schedule`);

    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});
test.after(async () => {
  await pool.end();
});
