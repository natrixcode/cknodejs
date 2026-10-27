import { pool } from '../config/database.js';
import { verifyPassword } from '../utils/password.js';
import {
  createSession,
  revokeSession
} from '../utils/sessions.js';

export async function login(data) {
  try {
    const { email, username, password } = data;

    const result = await pool.query(
      `SELECT
         id,
         username,
         name,
         email,
         password_hash,
         role,
         status,
         is_active
       FROM users
       WHERE (
         ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
         OR
         ($2::text IS NOT NULL AND username = $2)
       )
       LIMIT 1`,
      [email ?? null, username ?? null]
    );

    if (result.rows.length === 0) {
      return { status: 401, body: {
        message: 'Invalid credentials'
      } };
    }

    const user = result.rows[0];
    const validPassword = await verifyPassword(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return { status: 401, body: {
        message: 'Invalid credentials'
      } };
    }

    if (user.status !== 'active' || !user.is_active) {
      return { status: 403, body: {
        message: 'Account is not active'
      } };
    }

    const session = createSession(user.id);

    return { status: 200, body: {
      message: 'Login successful',
      access_token: session.token,
      token_type: 'Bearer',
      expires_at: session.expires_at,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      }
    } };
  } catch (error) {
    throw error;
  }
}

export async function logout(token) {
  try {
    const revoked = revokeSession(token);

    if (!revoked) {
      return { status: 401, body: {
        message: 'Session not found'
      } };
    }

    return { status: 200, body: {
      message: 'Logout successful'
    } };
  } catch (error) {
    throw error;
  }
}
