// driver controller — thin HTTP layer for the Agbede Driver endpoints.
// Identity comes from req.user; role is enforced by requireRole("DRIVER").

import { asyncHandler } from "../utils/errors.js";
import * as driverService from "../services/driverService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await driverService.me(req.user.id) });
});

// Signed-in customer applies to drive (no DRIVER role required yet).
export const apply = asyncHandler(async (req, res) => {
  const data = await driverService.apply({ userId: req.user.id, input: req.body, ...reqCtx(req) });
  res.status(201).json({ success: true, data });
});

export const availability = asyncHandler(async (req, res) => {
  const data = await driverService.setAvailability({ userId: req.user.id, ...req.body });
  res.json({ success: true, data });
});

export const offers = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await driverService.listOffers(req.user.id) });
});

export const accept = asyncHandler(async (req, res) => {
  const data = await driverService.acceptOffer({
    userId: req.user.id,
    kind: req.params.kind,
    id: req.params.id,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

export const decline = asyncHandler(async (req, res) => {
  const data = await driverService.declineOffer({
    userId: req.user.id,
    kind: req.params.kind,
    id: req.params.id,
  });
  res.json({ success: true, data });
});

export const trip = asyncHandler(async (req, res) => {
  const { kind, id, action } = req.params;
  const terminal = action === "complete" || action === "deliver";
  const data = terminal
    ? await driverService.complete({
        userId: req.user.id,
        kind,
        id,
        otpCode: req.body?.otpCode,
        ...reqCtx(req),
      })
    : await driverService.advance({
        userId: req.user.id,
        kind,
        id,
        action,
        ...reqCtx(req),
      });
  res.json({ success: true, data });
});

export const trips = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await driverService.trips(req.user.id) });
});

export const earnings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await driverService.earnings(req.user.id) });
});
