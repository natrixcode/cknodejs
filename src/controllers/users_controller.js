import * as service from '../services/users_service.js';

export async function getUsers(req, res, next) {
  try {
    const value = req.query.include_inactive;
    if (value !== undefined && value !== 'true' && value !== 'false') {
      return res.status(400).json({ message: 'include_inactive must be true or false' });
    }
    const result = await service.getUsers(value === 'true');

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function deactivateUser(req, res, next) {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(409).json({ message: 'You cannot deactivate your own account' });
    }
    const result = await service.deactivateUser(req.params.id);
    if (result.noContent) return res.status(result.status).end();
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
      return res.status(409).json({
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
      return res.status(409).json({
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
