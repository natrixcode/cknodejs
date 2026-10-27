import * as service from '../services/tuition_service.js';

export async function getTuitionRates(req, res, next) {
  try {
    const result = await service.getTuitionRates();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getTuitionRateById(req, res, next) {
  try {
    const result = await service.getTuitionRateById(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createTuitionRate(req, res, next) {
  try {
    const result = await service.createTuitionRate(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateTuitionRate(req, res, next) {
  try {
    const result = await service.updateTuitionRate(req.params.id, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function calculateTuition(req, res, next) {
  try {
    const result = await service.calculateTuition(req.query);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
