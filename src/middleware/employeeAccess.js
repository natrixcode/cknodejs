import { pool } from '../config/database.js';

export async function requireEmployeeAccess(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'employee') {
      return next();
    }

    const result = await pool.query(
      'SELECT kms_can_employee_access_api($1) AS allowed',
      [req.user.id]
    );

    if (!result.rows[0]?.allowed) {
      return res.status(403).json({
        message: 'Insufficient permissions'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
