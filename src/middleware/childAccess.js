
import { pool } from '../config/database.js';

export async function requireChildAccess(req, res, next) {
  try {
    const childId = req.params.id;

    if (!/^[1-9]\d*$/.test(childId)) {
      return res.status(400).json({
        message: 'Invalid child ID'
      });
    }

    if (BigInt(childId) > 9223372036854775807n) {
      return res.status(400).json({
        message: 'Invalid child ID'
      });
    }

    const result = await pool.query(
      `SELECT kms_can_view_child($1, $2) AS allowed`,
      [req.user.id, childId]
    );

    if (!result.rows[0]?.allowed) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

