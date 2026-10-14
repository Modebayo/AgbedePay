// Rate limiting — our first line of defence against brute-force attacks.
// Limits are deliberately different per endpoint:
//   register: 10/hour per IP (registration spam)
//   login:     5 per 15 min per phone+IP (PIN guessing)
//   OTP:       5 per 15 min per phone+IP (code guessing)
//   send:      5 per minute per user (rapid-fire money movement)
// In production, swap the in-memory store for Redis so limits survive
// multiple server processes/restarts.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Respond with OUR consistent error envelope, not the library default.
const envelope = (_req, res) =>
  res.status(429).json({
    success: false,
    message: "Too many attempts. Please try again later.",
    code: "RATE_LIMITED",
  });

const defaults = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: envelope,
};

export const registerLimiter = rateLimit({ ...defaults, windowMs: 60 * 60 * 1000, limit: 10 });

// Key = IP + phone, so an attacker hammering many phones still gets limited,
// but a legit user on a shared ISP (same IP, different phones) is not blocked.
// ipKeyGenerator() normalises IPv6 correctly (avoids the express-rate-limit
// IPv6-bypass validation warning).
const phoneKey = (req, res) => `${ipKeyGenerator(req, res)}:${req.body?.phone ?? "unknown"}`;

export const loginLimiter = rateLimit({ ...defaults, windowMs: 15 * 60 * 1000, limit: 5, keyGenerator: phoneKey });

export const otpLimiter = rateLimit({ ...defaults, windowMs: 15 * 60 * 1000, limit: 5, keyGenerator: phoneKey });

// Send-money limiter: keyed purely by the authenticated user id. requireAuth
// runs BEFORE this limiter on the route, so req.user is always present here —
// no reliance on req.ip (which also sidesteps IPv6-keying pitfalls).
export const sendMoneyLimiter = rateLimit({
  ...defaults,
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => String(req.user.id),
});

// Cargo quotation requests move no money but create work for admins, so they
// are bounded per user (form spam) rather than per IP.
export const cargoLimiter = rateLimit({
  ...defaults,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user.id),
});

// Checkout starts are keyed per user: each one creates a payment row (and, with
// a live gateway, a remote session). 20/hour is generous for a human topping up
// but stops scripted row-spam / gateway-session abuse.
export const paymentsLimiter = rateLimit({
  ...defaults,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user.id),
});

// Changing the transaction PIN is a high-value action (whoever controls the PIN
// controls the wallet), so it is tightly bounded per user to slow PIN guessing
// by an attacker who already holds a session.
export const pinChangeLimiter = rateLimit({
  ...defaults,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => String(req.user.id),
});