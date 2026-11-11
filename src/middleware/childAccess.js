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

    let sql = 'SELECT kms_can_view_child($1, $2) AS allowed';

    if (
      req.user.role === 'employee' &&
      req.user.employee_position === 'teacher'
    ) {
      sql = `
        SELECT EXISTS (
          SELECT 1
          FROM children c
          WHERE c.id = $2
            AND kms_can_view_group_children($1, c.group_id)
        ) AS allowed
      `;
    }

    const result = await pool.query(sql, [
      req.user.id,
      childId
    ]);

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
