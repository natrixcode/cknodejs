import assert from 'node:assert/strict';
import test from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';

const cases = {
  KMS_ATTENDANCE_FORBIDDEN: 403,
  KMS_ATTENDANCE_PAST_FORBIDDEN: 403,
  KMS_ATTENDANCE_FUTURE_DATE: 422,
  KMS_ATTENDANCE_INVALID_PARAMETERS: 422,
  KMS_ATTENDANCE_CORRECTION_REQUIRES_PAST: 422,
  KMS_ATTENDANCE_NOT_FOUND: 404,
  KMS_ATTENDANCE_IDENTITY_IMMUTABLE: 409,
  KMS_ATTENDANCE_GROUP_CHANGED: 409
};

for (const [message, expectedStatus] of Object.entries(cases)) {
  test(`${message} maps to ${expectedStatus}`, () => {
    let actualStatus;
    let body;

    const res = {
      headersSent: false,
      status(value) {
        actualStatus = value;
        return this;
      },
      json(value) {
        body = value;
        return this;
      }
    };

    errorHandler(
      { code: 'P0001', message },
      {},
      res,
      () => assert.fail('Unexpected next()')
    );

    assert.equal(actualStatus, expectedStatus);
    assert.deepEqual(body, { message });
  });
}