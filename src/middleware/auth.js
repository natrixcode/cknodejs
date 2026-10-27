import { pool } from '../config/database.js';
import { getSession } from '../utils/sessions.js';

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    const token = authorization.slice(7).trim();
    const session = getSession(token);

    if (!session) {
      return res.status(401).json({
        message: 'Invalid or expired session'
      });
    }

    const result = await pool.query(
      `SELECT id, username, name, email, role, status, is_active
       FROM users
       WHERE id = $1`,
      [session.userId]
    );

    if (
      result.rows.length === 0 ||
      result.rows[0].status !== 'active' ||
      !result.rows[0].is_active
    ) {
      return res.status(401).json({
        message: 'User account is not active'
      });
    }

    req.user = result.rows[0];
    req.authToken = token;

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Insufficient permissions'
      });
    }

    next();
  };
}
