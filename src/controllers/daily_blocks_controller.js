import * as service from '../services/daily_blocks_service.js';

export async function getDailyBlocks(req, res, next) {
  try {
    const result = await service.getDailyBlocks();
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getDailyBlockById(req, res, next) {
  try {
    const result = await service.getDailyBlockById(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createDailyBlock(req, res, next) {
  try {
    const result = await service.createDailyBlock(req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateDailyBlock(req, res, next) {
  try {
    const result = await service.updateDailyBlock(
      req.params.id,
      req.body
    );

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function deleteDailyBlock(req, res, next) {
  try {
    const result = await service.deleteDailyBlock(req.params.id);

    if (result.noContent) {
      return res.sendStatus(204);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
