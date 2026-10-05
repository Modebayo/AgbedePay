// wealth controller — thin HTTP layer for the Wealth endpoints.
// All identity comes from req.user (the authed session); there is never a
// client-supplied user_id in the request.

import { asyncHandler, ApiError, ErrorCodes } from "../utils/errors.js";
import * as wealthService from "../services/wealthService.js";
import * as retirementService from "../services/retirementService.js";

const MAX_RETURN_PCT = retirementService.MAX_RETURN_PCT;

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

// A filter that isn't a recognised value is a client bug, not an empty result.
function oneOf(value, allowed, field) {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).toUpperCase();
  if (!allowed.includes(v)) {
    throw new ApiError(400, `Unknown ${field}`, ErrorCodes.VALIDATION);
  }
  return v;
}

export const overview = asyncHandler(async (req, res) => {
  const data = await wealthService.getOverview({ userId: req.user.id });
  res.json({ success: true, data });
});

export const portfolio = asyncHandler(async (req, res) => {
  const data = await wealthService.getPortfolio({ userId: req.user.id });
  res.json({ success: true, data });
});

export const instruments = asyncHandler(async (req, res) => {
  const className = oneOf(req.query.class, ["STOCK", "FUND", "PENSION", "BOND"], "class");
  const data = await wealthService.listInstruments({ userId: req.user.id, className });
  res.json({ success: true, data });
});

export const instrumentDetail = asyncHandler(async (req, res) => {
  const data = await wealthService.getInstrument({
    userId: req.user.id,
    instrumentId: req.params.id,
  });
  res.json({ success: true, data });
});

export const history = asyncHandler(async (req, res) => {
  const page = positiveInt(req.query.page, 1, null);
  const limit = positiveInt(req.query.limit, 20, 100);
  const className = oneOf(req.query.class, ["STOCK", "FUND", "PENSION", "BOND"], "class");
  const type = oneOf(req.query.type, ["BUY", "SELL"], "type");

  const data = await wealthService.listHistory({
    userId: req.user.id,
    page,
    limit,
    className,
    type,
  });
  res.json({ success: true, data });
});

export const buy = asyncHandler(async (req, res) => {
  const data = await wealthService.buy({
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const sell = asyncHandler(async (req, res) => {
  const data = await wealthService.sell({
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

// ---- Retirement goal ----

// The return assumption arrives as a query string, so it is parsed here rather
// than through a schema (an `int` rule can never pass a string — the same trap
// wealthRouter documents for pagination). Out-of-range and non-numeric values
// fall back to the documented default instead of erroring: this is a display
// assumption, so a bad value should not take the page down.
function returnPctOf(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_RETURN_PCT) return undefined;
  return Math.round(n * 100) / 100; // two decimals: basis-point precision is plenty
}

export const retirementSummary = asyncHandler(async (req, res) => {
  const data = await retirementService.getSummary({
    userId: req.user.id,
    expectedAnnualReturnPct: returnPctOf(req.query.returnPct) ?? retirementService.DEFAULT_RETURN_PCT,
  });
  res.json({ success: true, data });
});

export const createRetirementGoal = asyncHandler(async (req, res) => {
  const data = await retirementService.createGoal({
    ...req.body,
    userId: req.user.id,
  });
  res.status(201).json({ success: true, data });
});

export const updateRetirementGoal = asyncHandler(async (req, res) => {
  const data = await retirementService.updateGoal({
    ...req.body,
    goalId: req.params.id,
    userId: req.user.id,
  });
  res.json({ success: true, data });
});

export const closeRetirementGoal = asyncHandler(async (req, res) => {
  const data = await retirementService.closeGoal({
    goalId: req.params.id,
    userId: req.user.id,
  });
  res.json({ success: true, data });
});
