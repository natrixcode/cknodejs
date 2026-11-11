import { pool } from '../config/database.js';

export async function requireGroupChildrenAccess(req, res, next) {
  try {
    const groupId = req.params.id;

    if (
      !/^[1-9]\d*$/.test(groupId) ||
      BigInt(groupId) > 9223372036854775807n
    ) {
      return res.status(400).json({
        message: 'Invalid group ID'
      });
    }

    const result = await pool.query(
      `SELECT kms_can_view_group_children($1, $2) AS allowed`,
      [req.user.id, groupId]
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
