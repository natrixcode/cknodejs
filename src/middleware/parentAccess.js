import { pool } from '../config/database.js';

export async function requireParentAccess(req, res, next) {
  try {
    const parentId = Number(req.params.id);

    if (!Number.isSafeInteger(parentId) || parentId <= 0) {
      return res.status(400).json({
        message: 'Invalid parent ID'
      });
    }

    const { rows } = await pool.query(
      'SELECT kms_can_access_parent($1, $2) AS allowed',
      [req.user.id, parentId]
    );

    if (!rows[0]?.allowed) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}