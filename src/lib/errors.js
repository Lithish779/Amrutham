'use strict';
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const E = {
  badRequest: (m = 'Bad request', d) => new AppError(400, 'BAD_REQUEST', m, d),
  unauthorized: (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m),
  forbidden: (m = 'Forbidden') => new AppError(403, 'FORBIDDEN', m),
  notFound: (m = 'Not found') => new AppError(404, 'NOT_FOUND', m),
  conflict: (code, m, d) => new AppError(409, code, m, d),
  unprocessable: (code, m) => new AppError(422, code, m),
  tooMany: (retryAfter) => Object.assign(new AppError(429, 'RATE_LIMITED', 'Too many requests'), { retryAfter }),
  unavailable: (m = 'Dependency unavailable') => new AppError(503, 'SERVICE_UNAVAILABLE', m),
};
module.exports = { AppError, E };
