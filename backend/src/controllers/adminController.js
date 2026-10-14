// admin controller — thin HTTP layer for the admin console.
// Identity comes from req.user; ADMIN access is enforced by requireRole.

import { asyncHandler } from "../utils/errors.js";
import * as adminService from "../services/adminService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

// Query strings arrive as text; keep only a clean, bounded value for the model.
function statusQuery(req) {
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  return status ? status.slice(0, 24) : null;
}

export const overview = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await adminService.overview() });
});

// ---------- Drivers ----------

export const listDrivers = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await adminService.listDrivers({ status: statusQuery(req) }) });
});

export const setDriverStatus = asyncHandler(async (req, res) => {
  const data = await adminService.setDriverStatus({
    adminId: req.user.id,
    userId: req.params.id,
    status: req.body.status,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

// ---------- Cargo ----------

export const listCargo = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await adminService.listCargo({ status: statusQuery(req) }) });
});

export const quoteCargo = asyncHandler(async (req, res) => {
  const data = await adminService.quoteCargo({
    adminId: req.user.id,
    id: req.params.id,
    quotedAmountMinor: req.body.quotedAmountMinor,
    adminNote: req.body.adminNote,
    status: req.body.status,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

// ---------- Support ----------

export const listSupport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await adminService.listSupport({ status: statusQuery(req) }) });
});

export const replySupport = asyncHandler(async (req, res) => {
  const data = await adminService.replySupport({
    adminId: req.user.id,
    id: req.params.id,
    reply: req.body.reply,
    status: req.body.status,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});

// ---------- Payments ----------

export const listPayments = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await adminService.listPayments({ status: statusQuery(req) }) });
});

export const reconcilePayment = asyncHandler(async (req, res) => {
  const data = await adminService.reconcilePayment({
    adminId: req.user.id,
    reference: req.params.reference,
    ...reqCtx(req),
  });
  res.json({ success: true, data });
});
