import * as service from '../services/history_service.js';

export async function getHistory(req, res, next) {
  try {
    const result = await service.getRecordHistory(req.query.table, req.query.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getStateAt(req, res, next) {
  try {
    const result = await service.getRecordStateAt(req.query.table, req.query.id, req.query.at);
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

