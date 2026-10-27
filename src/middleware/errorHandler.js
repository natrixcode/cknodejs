export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const sqlCode = error.code;

  const isBusinessError =
    sqlCode === 'P0001' &&
    /^KMS_[A-Z0-9_]+$/.test(error.message);

  let status = 500;
  let message = 'Внутрішня помилка сервера';

  if (
    [
      '22P02',
      '22007',
      '23502',
      '23514'
    ].includes(sqlCode)
  ) {
    status = 400;
    message =
      'Некоректні дані або порушено обмеження бази даних';
  } else if (
    [
      '23505',
      '23503',
      '23P01'
    ].includes(sqlCode)
  ) {
    status = 409;
    message = 'Конфлікт з наявними даними';
  } else if (isBusinessError) {
    status = error.message.endsWith('_NOT_FOUND')
      ? 404
      : error.message.includes('INVALID')
        ? 400
        : 409;

    message = error.message;
  }

  if (status === 500) {
    console.error('Unhandled server error:', error);
  }

  return res.status(status).json({ message });
}