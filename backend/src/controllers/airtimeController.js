// airtime controller — thin HTTP layer for the airtime purchase flow.

import { asyncHandler } from "../utils/errors.js";
import * as purchaseService from "../services/purchaseService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: purchaseService.listAirtimeProviders() });
});

export const purchase = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await purchaseService.purchaseAirtime({
      userId: req.user.id,
      network: req.body.network,
      phone: req.body.phone,
      amountMinor: req.body.amountMinor,
      pin: req.body.pin,
      idempotencyKey: req.idempotencyKey,
      ...reqCtx(req),
    }),
  });
});