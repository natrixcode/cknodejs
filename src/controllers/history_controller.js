
import * as service from '../services/history_service.js';

export async function getHistory(req, res, next) {
  try {
    const { table, id } = res.locals.validatedQuery;

    const result = await service.getRecordHistory(table, id);

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getStateAt(req, res, next) {
  try {
    const { table, id, at } = res.locals.validatedQuery;

    const result = await service.getRecordStateAt(table, id, at);

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
