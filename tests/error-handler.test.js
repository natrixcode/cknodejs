
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { errorHandler } from '../src/middleware/errorHandler.js';

async function checkError(error, expectedStatus, expectedMessage) {
  const app = express();

  app.get('/test', (req, res, next) => {
    next(error);
  });

  app.use(errorHandler);

  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/test`
    );

    assert.equal(response.status, expectedStatus);

    const body = await response.json();

    assert.equal(body.message, expectedMessage);
    assert.equal(Object.keys(body).length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
}

test('Invalid child age returns 400', async () => {
  await checkError(
    { code: 'P0001', message: 'KMS_CHILD_AGE_OUT_OF_RANGE' },
    400,
    'KMS_CHILD_AGE_OUT_OF_RANGE'
  );
});

test('Child age mismatch returns 400', async () => {
  await checkError(
    { code: 'P0001', message: 'KMS_CHILD_AGE_MISMATCH' },
    400,
    'KMS_CHILD_AGE_MISMATCH'
  );
});

test('Full group returns 409', async () => {
  await checkError(
    { code: 'P0001', message: 'KMS_GROUP_FULL' },
    409,
    'KMS_GROUP_FULL'
  );
});

test('Missing child returns 404', async () => {
  await checkError(
    { code: 'P0001', message: 'KMS_CHILD_NOT_FOUND' },
    404,
    'KMS_CHILD_NOT_FOUND'
  );
});

test('Invalid SQL input returns 400', async () => {
  await checkError(
    { code: '22P02', message: 'SQL internal details' },
    400,
    'Некоректні дані або порушено обмеження бази даних'
  );
});

test('Unique constraint returns 409', async () => {
  await checkError(
    { code: '23505', message: 'SQL internal details' },
    409,
    'Конфлікт з наявними даними'
  );
});

test('Unknown error returns safe 500', async () => {
  await checkError(
    { code: 'XX000', message: 'SELECT secret FROM users' },
    500,
    'Внутрішня помилка сервера'
  );
});

test('Unknown KMS error returns 500', async () => {
  await checkError(
    { code: 'P0001', message: 'KMS_UNKNOWN_ERROR' },
    500,
    'Внутрішня помилка сервера'
  );
});
test('Malformed JSON returns 400', async () => {
  const app = express();

  app.use(express.json());
  app.post('/test-json', (req, res) => {
    res.status(201).json({ status: 'success' });
  });
  app.use(errorHandler);

  const server = app.listen(0);

  try {
    const address = server.address();

    const response = await fetch(
      `http://127.0.0.1:${address.port}/test-json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{"name":"Test",}'
      }
    );

    assert.equal(response.status, 400);

    const result = await response.json();
    assert.deepEqual(result, {
      message: 'Некоректний JSON'
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });
  }
});