// betting controller — thin HTTP layer for betting account top-ups.

import { asyncHandler } from "../utils/errors.js";
import * as purchaseService from "../services/purchaseService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: purchaseService.listBettingPlatforms() });
});

export const lookup = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await purchaseService.lookupBettingAccount({
      platform: req.body.platform,
      customerId: req.body.customerId,
    }),
  });
});

export const purchase = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await purchaseService.purchaseBetting({
      userId: req.user.id,
      platform: req.body.platform,
      customerId: req.body.customerId,
      amountMinor: req.body.amountMinor,
      pin: req.body.pin,
      idempotencyKey: req.idempotencyKey,
      ...reqCtx(req),
    }),
  });
});