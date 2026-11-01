import { pool } from '../config/database.js';

export async function requireScheduleAccess(req, res, next) {
  try {
    const scheduleId = req.params.id;

    if (!/^[1-9]\d*$/.test(scheduleId)) {
      return res.status(400).json({
        message: 'Invalid schedule ID'
      });
    }

    const id = BigInt(scheduleId);

    if (id > 9223372036854775807n) {
      return res.status(400).json({
        message: 'Invalid schedule ID'
      });
    }

    const { rows } = await pool.query(
      'SELECT kms_can_view_schedule($1, $2) AS allowed',
      [req.user.id, scheduleId]
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