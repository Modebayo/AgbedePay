// 404 for any unmatched /api/* request (registered AFTER all real API routes).

import { ApiError, ErrorCodes } from "../utils/errors.js";

export function apiNotFound(req, _res, next) {
  next(new ApiError(404, `API endpoint not found: ${req.method} ${req.originalUrl}`, ErrorCodes.NOT_FOUND));
}