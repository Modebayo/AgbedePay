// withdraw controller — thin HTTP layer for bank accounts + cash-outs.

import { asyncHandler } from "../utils/errors.js";
import * as withdrawService from "../services/withdrawService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const listAccounts = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await withdrawService.listAccounts(req.user.id) });
});

export const addAccount = asyncHandler(async (req, res) => {
  const data = await withdrawService.addAccount({ userId: req.user.id, ...req.body });
  res.status(201).json({ success: true, data, message: "Bank account linked." });
});

export const removeAccount = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await withdrawService.removeAccount({ userId: req.user.id, accountId: req.params.id }),
  });
});

export const withdraw = asyncHandler(async (req, res) => {
  const data = await withdrawService.withdrawToBank({
    userId: req.user.id,
    accountId: req.body.accountId,
    amountMinor: req.body.amountMinor,
    pin: req.body.pin,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});