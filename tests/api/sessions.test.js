
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession,
  getSession,
  revokeSession,
  revokeUserSessions
} from '../../src/utils/sessions.js';

test('Session is created and can be retrieved', () => {
  const session = createSession('test-user-1');

  assert.ok(session.token);
  assert.ok(session.expires_at);
  assert.equal(getSession(session.token).userId, 'test-user-1');

  revokeSession(session.token);
});

test('Logout revokes session', () => {
  const session = createSession('test-user-2');

  assert.equal(revokeSession(session.token), true);
  assert.equal(getSession(session.token), null);
});

test('All user sessions can be revoked', () => {
  const first = createSession('test-user-3');
  const second = createSession('test-user-3');
  const other = createSession('test-user-4');

  assert.equal(revokeUserSessions('test-user-3'), 2);

  assert.equal(getSession(first.token), null);
  assert.equal(getSession(second.token), null);

  assert.ok(getSession(other.token));

  revokeSession(other.token);
});

test('Invalid session token is rejected', () => {
  assert.equal(getSession('invalid-token'), null);
  assert.equal(getSession(null), null);
});
