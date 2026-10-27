import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);

  return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split(':');

  if (
    parts.length !== 3 ||
    parts[0] !== 'scrypt' ||
    !/^[0-9a-f]{32}$/.test(parts[1]) ||
    !/^[0-9a-f]{128}$/.test(parts[2])
  ) {
    return false;
  }

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await scrypt(password, salt, expected.length);

  return timingSafeEqual(actual, expected);
}
