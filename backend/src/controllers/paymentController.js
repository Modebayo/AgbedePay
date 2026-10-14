// payment controller — thin HTTP layer for hosted-checkout wallet funding.

import { asyncHandler } from "../utils/errors.js";
import * as paymentService from "../services/paymentService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const initiate = asyncHandler(async (req, res) => {
  const data = await paymentService.initiate({
    userId: req.user.id,
    amountMinor: req.body.amountMinor,
    ctx: reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const verify = asyncHandler(async (req, res) => {
  const data = await paymentService.verify({
    userId: req.user.id,
    reference: req.body.reference,
    ctx: reqCtx(req),
  });
  res.json({ success: true, data });
});

export const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await paymentService.list(req.user.id) });
});

export const reconcile = asyncHandler(async (req, res) => {
  const data = await paymentService.reconcile({ reference: req.body.reference });
  res.json({ success: true, data });
});

// Unauthenticated: the gateway calls this. Authenticity comes from the provider
// signature check inside the service, not from a session.
export const webhook = asyncHandler(async (req, res) => {
  const data = await paymentService.handleWebhook({
    providerName: req.params.provider ? String(req.params.provider).toUpperCase() : null,
    headers: req.headers,
    rawBody: req.rawBody,
    body: req.body,
  });
  res.status(200).json({ success: true, data });
});
