
const businessErrors = {
  KMS_CHILD_AGE_OUT_OF_RANGE: 400,
  KMS_CHILD_AGE_MISMATCH: 400,
  KMS_GROUP_AGE_CHANGE_INVALID: 400,
  KMS_GROUP_REQUIRED: 400,
  KMS_IDS_REQUIRED: 400,
  KMS_CHILD_ID_REQUIRED: 400,
  KMS_GROUP_EXCEEDS_ROOM_CAPACITY: 400,

  KMS_CHILD_NOT_FOUND: 404,
  KMS_GROUP_NOT_FOUND: 404,
  KMS_ROOM_NOT_FOUND: 404,

  KMS_GROUP_FULL: 409,
  KMS_GROUP_CAPACITY_BELOW_OCCUPANCY: 409,
  KMS_ROOM_UNAVAILABLE: 409,
  KMS_CHILD_ALREADY_ASSIGNED: 409,
  KMS_CHILD_NOT_ASSIGNED: 409,
  KMS_TRANSFER_NOT_APPLICABLE: 409,
  KMS_ASSIGNED_ROOM_CANNOT_CHANGE: 409,
  KMS_ROOM_LIMIT_REACHED: 409,
};

const badRequestCodes = new Set([
  '22P02',
  '22007',
  '23502',
  '23514',
]);

const conflictCodes = new Set([
  '23505',
  '23503',
  '23P01',
]);

export function errorHandler(error, req, res, next) {
  if (error.type === 'entity.parse.failed' && error.status === 400) {
  return res.status(400).json({
    message: 'Некоректний JSON'
  });
}
  if (res.headersSent) {
    return next(error);
  }

  const sqlCode = error?.code;
  const sqlMessage = error?.message;

  let status = 500;
  let message = 'Внутрішня помилка сервера';

  if (
    sqlCode === 'P0001' &&
    typeof sqlMessage === 'string' &&
    Object.hasOwn(businessErrors, sqlMessage)
  ) {
    status = businessErrors[sqlMessage];
    message = sqlMessage;
  } else if (badRequestCodes.has(sqlCode)) {
    status = 400;
    message = 'Некоректні дані або порушено обмеження бази даних';
  } else if (conflictCodes.has(sqlCode)) {
    status = 409;
    message = 'Конфлікт з наявними даними';
  }

  if (status === 500) {
    console.error('Unhandled server error:', error);
  }

  return res.status(status).json({ message });
}
