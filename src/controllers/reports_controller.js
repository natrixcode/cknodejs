import * as service from '../services/reports_service.js';

export async function getFinanceReport(req, res, next) {
  try {
    const result = await service.getFinanceReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getProfitReport(req, res, next) {
  try {
    const result = await service.getProfitReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getGroupsProfitReport(
  req,
  res,
  next
) {
  try {
    const result =
      await service.getGroupsProfitReport(
        res.locals.reportFilters
      );

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getGroupProfitReport(
  req,
  res,
  next
) {
  try {
    const result =
      await service.getGroupProfitReport(
        req.params.groupId,
        res.locals.reportFilters
      );

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getExpensesReport(req, res, next) {
  try {
    const result = await service.getExpensesReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getRevenueReport(req, res, next) {
  try {
    const result = await service.getRevenueReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getSalariesReport(req, res, next) {
  try {
    const result = await service.getSalariesReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getBreakEvenReport(req, res, next) {
  try {
    const result = await service.getBreakEvenReport();

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

export async function getDashboardReport(req, res, next) {
  try {
    const result = await service.getDashboardReport(res.locals.reportFilters);

    if (result.noContent) {
      return res.sendStatus(result.status);
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}
