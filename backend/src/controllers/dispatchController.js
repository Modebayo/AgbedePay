// dispatch controller — thin HTTP layer for Logistics & Dispatch.
// All identity comes from req.user (the authed session); there is never a
// client-supplied user_id in the request.

import { asyncHandler } from "../utils/errors.js";
import * as dispatchService from "../services/dispatchService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await dispatchService.meta() });
});

export const quote = asyncHandler(async (req, res) => {
  const data = await dispatchService.quoteService(req.body);
  res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const data = await dispatchService.createBooking({
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const list = asyncHandler(async (req, res) => {
  const data = await dispatchService.listBookings(req.user.id);
  res.json({ success: true, data });
});

export const detail = asyncHandler(async (req, res) => {
  const data = await dispatchService.getBooking({ userId: req.user.id, id: req.params.id });
  res.json({ success: true, data });
});

export const advance = asyncHandler(async (req, res) => {
  const data = await dispatchService.advanceBooking({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const cancel = asyncHandler(async (req, res) => {
  const data = await dispatchService.cancelBooking({
    userId: req.user.id,
    id: req.params.id,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const rate = asyncHandler(async (req, res) => {
  const data = await dispatchService.rateBooking({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const issue = asyncHandler(async (req, res) => {
  const data = await dispatchService.reportIssue({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});