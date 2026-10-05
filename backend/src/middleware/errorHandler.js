// Central error middleware — every error in the app funnels through here.
// It keeps responses consistent and NEVER leaks internals to the client.

import { env } from "../config/env.js";

// eslint-disable-next-line no-unused-vars -- Express needs 4 params to know this is an error handler
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? 500;
  const isServerError = status >= 500;

  // Only server errors get the full stack logged (never in production output to client).
  if (isServerError) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  res.status(status).json({
    success: false,
    message: isServerError
      ? env.isProduction
        ? "Internal server error"
        : err.message
      : err.message,
    code: err.code ?? "INTERNAL_ERROR",
    ...(err.details ? { details: err.details } : {}),
  });
}