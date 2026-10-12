// auth controller — thin HTTP layer for authentication endpoints.
// Parses the request, calls the service, sets/clears the session cookie,
// and sends the response. No PIN logic or SQL here.

import { asyncHandler } from "../utils/errors.js";
import * as authService from "../services/authService.js";
import { SESSION_COOKIE } from "../middleware/requireAuth.js";
import { env } from "../config/env.js";

// Request context every audit log wants. Never contains secrets.
const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript in the browser cannot read it → XSS can't steal it
    sameSite: "strict", // never sent on cross-site requests → CSRF protection
    secure: env.isProduction, // only over HTTPS in production
    path: "/",
    maxAge: env.sessionTtlMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export const register = asyncHandler(async (req, res) => {
  const data = await authService.register({ ...req.body, ...reqCtx(req) });
  if (data.token) setSessionCookie(res, data.token);
  res.status(201).json({
    success: true,
    data,
    message: "Account created — you are now signed in.",
  });
});

export const login = asyncHandler(async (req, res) => {
  const data = await authService.login({ ...req.body, ...reqCtx(req) });
  if (data.token) setSessionCookie(res, data.token);
  res.json({ success: true, data, message: data.requiresOtp ? "Security code required." : "Logged in successfully." });
});

export const loginOtp = asyncHandler(async (req, res) => {
  const data = await authService.completeLoginWithOtp({ ...req.body, ...reqCtx(req) });
  setSessionCookie(res, data.token);
  res.json({ success: true, data, message: "Logged in successfully." });
});

export const loginOtpToggle = asyncHandler(async (req, res) => {
  const data = await authService.setLoginOtpEnabled({
    userId: req.user.id,
    enabled: req.body.enabled,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const securityAlertToggle = asyncHandler(async (req, res) => {
  const data = await authService.setSecurityAlertEnabled({
    userId: req.user.id,
    enabled: req.body.enabled,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ sessionId: req.sessionId, userId: req.user.id, ...reqCtx(req) });
  clearSessionCookie(res);
  res.json({ success: true, data: { loggedOut: true } });
});

export const listSessions = asyncHandler(async (req, res) => {
  const data = await authService.listSessions({
    userId: req.user.id,
    currentSessionId: req.sessionId,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const revokeSession = asyncHandler(async (req, res) => {
  const data = await authService.revokeSession({
    sessionId: req.params.id,
    currentSessionId: req.sessionId,
    userId: req.user.id,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const forgotPin = asyncHandler(async (req, res) => {
  const data = await authService.forgotPin({ ...req.body, ...reqCtx(req) });
  res.json({ success: true, data });
});

export const resetPin = asyncHandler(async (req, res) => {
  const data = await authService.resetPin({ ...req.body, ...reqCtx(req) });
  res.json({ success: true, data });
});

export const changePin = asyncHandler(async (req, res) => {
  const data = await authService.changePin({
    userId: req.user.id,
    currentPin: req.body.currentPin,
    newPin: req.body.newPin,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});