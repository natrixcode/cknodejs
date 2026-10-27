import * as service from '../services/settings_service.js';

export async function getSettings(req, res, next) {
  try {
    const result = await service.getSettings();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getSettingByKey(req, res, next) {
  try {
    const result = await service.getSettingByKey(req.params.key);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateSettingByKey(req, res, next) {
  try {
    const result = await service.updateSettingByKey(req.params.key, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getAcademicYear(req, res, next) {
  try {
    const result = await service.getAcademicYear();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateAcademicYear(req, res, next) {
  try {
    const result = await service.updateAcademicYear(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
