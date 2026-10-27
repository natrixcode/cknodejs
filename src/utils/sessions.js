import { createHash, randomBytes } from 'node:crypto';

const sessions = new Map();
const SESSION_LIFETIME = 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_LIFETIME;

  sessions.set(hashToken(token), {
    userId: String(userId),
    expiresAt
  });

  return {
    token,
    expires_at: new Date(expiresAt).toISOString()
  };
}

export function getSession(token) {
  if (typeof token !== 'string') {
    return null;
  }

  const key = hashToken(token);
  const session = sessions.get(key);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }

  return session;
}

export function revokeSession(token) {
  if (typeof token !== 'string') {
    return false;
  }

  return sessions.delete(hashToken(token));
}
