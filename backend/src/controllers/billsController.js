// bills controller — thin HTTP layer for electricity, data and cable payments.

import { asyncHandler } from "../utils/errors.js";
import * as purchaseService from "../services/purchaseService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      electricity: purchaseService.listElectricityProviders(),
      data: purchaseService.listDataProviders(),
      cable: purchaseService.listCableProviders(),
    },
  });
});

export const electricity = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await purchaseService.purchaseElectricity({
      userId: req.user.id,
      disCo: req.body.disCo,
      meterNo: req.body.meterNo,
      meterType: req.body.meterType,
      amountMinor: req.body.amountMinor,
      phone: req.body.phone,
      pin: req.body.pin,
      idempotencyKey: req.idempotencyKey,
      ...reqCtx(req),
    }),
  });
});

export const data = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await purchaseService.purchaseData({
      userId: req.user.id,
      network: req.body.network,
      planId: req.body.planId,
      phone: req.body.phone,
      pin: req.body.pin,
      idempotencyKey: req.idempotencyKey,
      ...reqCtx(req),
    }),
  });
});

export const cableLookup = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await purchaseService.lookupCableAccount({
      provider: req.body.provider,
      decoderNo: req.body.decoderNo,
    }),
  });
});

export const cableSubscribe = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await purchaseService.purchaseCableSubscription({
      userId: req.user.id,
      provider: req.body.provider,
      decoderNo: req.body.decoderNo,
      planId: req.body.planId,
      phone: req.body.phone,
      pin: req.body.pin,
      idempotencyKey: req.idempotencyKey,
      ...reqCtx(req),
    }),
  });
});