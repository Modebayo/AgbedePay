// requireIdempotencyKey — every money-moving request must carry a client
// generated "Idempotency-Key" header. It lets us turn "I clicked send twice"
// into ONE transfer: the second request with the same key replays the first
// request's result instead of moving money again (see docs/transactions.md).
//
// We only check the SHAPE here. Detecting a true duplicate happens in the
// service + database transaction (which holds the authoritative answer).

import { ApiError } from "../utils/errors.js";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 128;

export function requireIdempotencyKey(req, _res, next) {
  const raw = req.headers[IDEMPOTENCY_HEADER];
  const key = typeof raw === "string" ? raw.trim() : "";

  if (!key || key.length > MAX_KEY_LENGTH) {
    return next(
      new ApiError(400, "A valid Idempotency-Key header is required", "VALIDATION_ERROR")
    );
  }

  req.idempotencyKey = key; // the captured, validated key — never a stale body value
  next();
}