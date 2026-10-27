import * as service from '../services/health_service.js';

export async function getHealth(req, res, next) {
  try {
    const result = await service.getHealth();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getLiveness(req, res, next) {
  try {
    const result = await service.getLiveness();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getReadiness(req, res, next) {
  try {
    const result = await service.getReadiness();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
