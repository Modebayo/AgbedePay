// requireAuth — the AUTHORIZATION gate for protected endpoints.
// It decides WHO the request belongs to (the session's user) — the app never
// trusts a user_id sent by the client. Everything downstream uses req.user.

import * as sessionModel from "../models/sessions.js";
import { sha256 } from "../utils/crypto.js";
import { ApiError, ErrorCodes, asyncHandler } from "../utils/errors.js";

export const SESSION_COOKIE = "agbedepay_session";

// Accept the session token from the httpOnly cookie OR an Authorization header
// (the header form is handy for API clients and mobile apps later).
function extractToken(req) {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  const header = req.headers.authorization;
  const fromHeader = header?.startsWith("Bearer ") ? header.slice(7) : null;
  return fromCookie ?? fromHeader;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    throw new ApiError(401, "Authentication required", ErrorCodes.UNAUTHORIZED);
  }

  const session = await sessionModel.findValidByTokenHash(sha256(token));
  if (!session) {
    throw new ApiError(401, "Invalid or expired session", ErrorCodes.UNAUTHORIZED);
  }

  if (session.status !== "ACTIVE") {
    throw new ApiError(403, "Account is not active", ErrorCodes.FORBIDDEN);
  }

  req.user = {
    id: session.user_id,
    fullName: session.full_name,
    phone: session.phone,
    email: session.email,
    status: session.status,
    isVerified: session.is_verified,
  };
  req.sessionId = session.session_id;
  req.sessionExpiresAt = session.expires_at;

  next();
});