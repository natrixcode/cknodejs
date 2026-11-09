const MAX_BIGINT = 9223372036854775807n;

export function validateRouteId(req, res, next, value, name) {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    BigInt(value) > MAX_BIGINT
  ) {
    return res.status(400).json({
      message: `Invalid ${name} ID`
    });
  }

  next();
}
