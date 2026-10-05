// savings controller — thin HTTP layer for savings endpoints.
// All identity comes from req.user (the authed session); there is never a
// client-supplied user_id in the request.

import { asyncHandler, ApiError, ErrorCodes } from "../utils/errors.js";
import * as savingsService from "../services/savingsService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

// Query params travel as strings. Coerce safely; reject non-integer values.
function positiveInt(value, fallback, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ApiError(400, "Pagination values must be positive integers", ErrorCodes.VALIDATION);
  }
  return max ? Math.min(n, max) : n;
}

export const create = asyncHandler(async (req, res) => {
  const data = await savingsService.createGoal({
    ...req.body,
    userId: req.user.id,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const list = asyncHandler(async (req, res) => {
  const data = await savingsService.listGoals(req.user.id);
  res.json({ success: true, data });
});

export const detail = asyncHandler(async (req, res) => {
  const page = positiveInt(req.query.page, 1, null);
  const limit = positiveInt(req.query.limit, 20, 50);

  const data = await savingsService.getGoalDetail({
    userId: req.user.id,
    goalId: req.params.id,
    page,
    limit,
  });
  res.json({ success: true, data });
});

export const deposit = asyncHandler(async (req, res) => {
  const data = await savingsService.depositToGoal({
    goalId: req.params.id,
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const withdraw = asyncHandler(async (req, res) => {
  const data = await savingsService.withdrawFromGoal({
    goalId: req.params.id,
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});