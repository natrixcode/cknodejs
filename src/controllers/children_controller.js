import * as service from '../services/children_service.js';

export async function getChildren(req, res, next) {
  try {
    const result = await service.getChildren(req.query);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function archiveChild(req, res, next) {
  try {
    const result = await service.archiveChild(req.params.id, req.body?.reason);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function unarchiveChild(req, res, next) {
  try {
    const result = await service.unarchiveChild(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildById(req, res, next) {
  try {
    const result = await service.getChildById(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createChild(req, res, next) {
  try {
    const result = await service.createChild(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateChild(req, res, next) {
  try {
    const result = await service.updateChild(req.params.id, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildParents(req, res, next) {
  try {
    const result = await service.getChildParents(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildGroups(req, res, next) {
  try {
    const result = await service.getChildGroups(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildInvoices(req, res, next) {
  try {
    const result = await service.getChildInvoices(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildPayments(req, res, next) {
  try {
    const result = await service.getChildPayments(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getChildSchedule(req, res, next) {
  try {
    const result = await service.getChildSchedule(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
