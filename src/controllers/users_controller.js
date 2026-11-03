import * as service from '../services/users_service.js';

export async function getUsers(req, res, next) {
  try {
    const result = await service.getUsers();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getUserById(req, res, next) {
  try {
    const result = await service.getUserById(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function createUser(req, res, next) {
  try {
    const result = await service.createUser(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req, res, next) {
  try {
    const result = await service.updateUser(req.params.id, req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function updateUserRole(req, res, next) {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(403).json({
        message: 'You cannot change your own role'
      });
    }

    const result = await service.updateUserRole(
      req.params.id,
      req.body
    );

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
export async function updateUserStatus(req, res, next) {
  try {
    if (
      String(req.user.id) === String(req.params.id) &&
      req.body.status !== 'active'
    ) {
      return res.status(403).json({
        message: 'You cannot deactivate your own account'
      });
    }

    const result = await service.updateUserStatus(
      req.params.id,
      req.body
    );

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
