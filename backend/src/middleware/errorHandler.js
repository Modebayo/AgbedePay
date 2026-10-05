// Central error middleware — every error in the app funnels through here.
// It keeps responses consistent and NEVER leaks internals to the client.

import { env } from "../config/env.js";

// eslint-disable-next-line no-unused-vars -- Express needs 4 params to know this is an error handler
export function errorHandler(err, req, res, _next) {
  // Multer rejects with plain `Error`s carrying a `code` like LIMIT_FILE_SIZE and
  // no HTTP `status`. Left alone, an oversized upload would surface as a 500 with
  // the internal message "File too large" — wrong status, and it pollutes the
  // server-error log with what is really a client mistake. These are mapped to
  // proper 4xx responses here so the client can show something useful.
  //
  // `code` is normalised to a string first: multer's MulterError instances carry
  // a STRING code, but leaving this open to a non-string would let `err.code`
  // collide with Node's own numeric `err.code` (e.g. ECONNREFUSED), which
  // errorHandler would then report to the client as its error code.
  const errCode = typeof err?.code === "string" ? err.code : null;

  if (errCode === "LIMIT_FILE_SIZE") {
    err.status = 413;
    err.message = "That image is too large. The limit is 2 MB.";
  } else if (errCode === "LIMIT_UNEXPECTED_FILE" || errCode === "LIMIT_FILE_COUNT") {
    err.status = 400;
    err.message = 'Upload the picture as a single file in the "avatar" field.';
  } else if (errCode === "LIMIT_PART_COUNT" || errCode === "LIMIT_FIELD_COUNT") {
    err.status = 400;
    err.message = "That upload contained unexpected extra data.";
  } else if (errCode?.startsWith("LIMIT_")) {
    err.status = 400;
    err.message = "That upload was rejected.";
  }

  const status = err.status ?? 500;
  const isServerError = status >= 500;

  // Only server errors get the full stack logged (never in production output to client).
  if (isServerError) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  // Headers may already be flushed if the failure happened mid-stream (an upload
  // cut off mid-part). Writing a JSON body then throws ERR_HTTP_HEADERS_SENT and
  // masks the real problem, so the connection is simply ended.
  if (res.headersSent) {
    res.end();
    return;
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