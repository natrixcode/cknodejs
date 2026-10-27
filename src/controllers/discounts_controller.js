import * as service from '../services/discounts_service.js';

export async function getDiscounts(req, res, next) {
  try {
    const result = await service.getDiscounts();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getDiscountById(req, res, next) {
  try {
    const result = await service.getDiscountById(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createDiscount(req, res, next) {
  try {
    const result = await service.createDiscount(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateDiscount(req, res, next) {
  try {
    const result = await service.updateDiscount(req.params.id, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildDiscounts(req, res, next) {
  try {
    const result = await service.getChildDiscounts(req.params.childId);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function addChildDiscount(req, res, next) {
  try {
    const result = await service.addChildDiscount(req.params.childId, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function removeChildDiscount(req, res, next) {
  try {
    const result = await service.removeChildDiscount(req.params.childId, req.params.discountId);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
