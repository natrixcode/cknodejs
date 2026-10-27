import * as service from '../services/salaries_service.js';

export async function getSalaries(req, res, next) {
  try {
    const result = await service.getSalaries();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getSalaryById(req, res, next) {
  try {
    const result = await service.getSalaryById(req.params.id);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function calculateSalary(req, res, next) {
  try {
    const result = await service.calculateSalary(req.body);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeSalaries(req, res, next) {
  try {
    const result = await service.getEmployeeSalaries(req.params.employeeId);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
