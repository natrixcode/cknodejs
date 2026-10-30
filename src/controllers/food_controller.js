import * as service from '../services/food_service.js';

export async function getFoodRates(req, res, next) {
  try {
    const result = await service.getFoodRates();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createFoodRate(req, res, next) {
  try {
    const result = await service.createFoodRate(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateFoodRate(req, res, next) {
  try {
    const result = await service.updateFoodRate(req.params.id, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function calculateFoodCost(req, res, next) {
  try {
    const result = await service.calculateFoodCost(
      res.locals.foodCalculation
    );

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
