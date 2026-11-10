import * as service from '../services/attendance_service.js';

export async function markAttendance(req, res, next) {
  try {
    const result = await service.markAttendance(
      req.user.id,
      req.body
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function correctAttendance(req, res, next) {
  try {
    const result = await service.correctAttendance(
      req.user.id,
      req.params.id,
      req.body
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getGroupAttendance(req, res, next) {
  try {
    const result = await service.getGroupAttendance(
      req.user.id,
      req.params.id,
      req.attendanceQuery.date
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}