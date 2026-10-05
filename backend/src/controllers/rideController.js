// ride controller — thin HTTP layer for Ride-Hailing endpoints.
// All identity comes from req.user (the authed session).

import { asyncHandler } from "../utils/errors.js";
import * as rideService from "../services/rideService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await rideService.meta() });
});

export const quote = asyncHandler(async (req, res) => {
  const data = await rideService.quoteService(req.body);
  res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const data = await rideService.createBooking({
    ...req.body,
    userId: req.user.id,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const list = asyncHandler(async (req, res) => {
  const data = await rideService.listBookings(req.user.id);
  res.json({ success: true, data });
});

export const detail = asyncHandler(async (req, res) => {
  const data = await rideService.getBooking({ userId: req.user.id, id: req.params.id });
  res.json({ success: true, data });
});

export const advance = asyncHandler(async (req, res) => {
  const data = await rideService.advanceBooking({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const cancel = asyncHandler(async (req, res) => {
  const data = await rideService.cancelBooking({
    userId: req.user.id,
    id: req.params.id,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const share = asyncHandler(async (req, res) => {
  const data = await rideService.shareLive({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const rate = asyncHandler(async (req, res) => {
  const data = await rideService.rateBooking({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const issue = asyncHandler(async (req, res) => {
  const data = await rideService.reportIssue({
    userId: req.user.id,
    id: req.params.id,
    ...req.body,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});