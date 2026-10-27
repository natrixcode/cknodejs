import * as service from '../services/auth_service.js';

export async function login(req, res, next) {
  try {
    const result = await service.login(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    const result = await service.logout(req.authToken);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
