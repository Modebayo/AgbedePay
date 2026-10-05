// Central error type and the async wrapper used by every controller.

// An error that CARRIES information about the HTTP response we should send.
// status: HTTP status code (400, 401, 403, 404, 422, 500...)
// code:   stable machine-readable string the frontend can branch on
export class ApiError extends Error {
  constructor(status, message, code = "INTERNAL_ERROR", details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ErrorCodes = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL: "INTERNAL_ERROR",
};

// Express 4 does NOT catch errors thrown inside async handlers by itself.
// If a Promise rejects (e.g. a DB call fails) the request would just hang.
// asyncHandler wraps a controller and forwards any rejection to next(err),
// which lands in the central error middleware.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);