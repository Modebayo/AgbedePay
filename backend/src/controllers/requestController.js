// payment-request controller — thin HTTP layer for "request money".

import { asyncHandler } from "../utils/errors.js";
import * as paymentRequestService from "../services/paymentRequestService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const request = asyncHandler(async (req, res) => {
  const data = await paymentRequestService.requestMoney({
    requesterId: req.user.id,
    payerPhone: req.body.payerPhone,
    amountMinor: req.body.amountMinor,
    note: req.body.note,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data, message: "Payment request sent." });
});

export const list = asyncHandler(async (req, res) => {
  const data = await paymentRequestService.listRequests({
    userId: req.user.id,
    myPhone: req.user.phone,
  });
  res.json({ success: true, data });
});

export const pay = asyncHandler(async (req, res) => {
  const data = await paymentRequestService.payRequest({
    userId: req.user.id,
    myPhone: req.user.phone,
    requestId: req.params.id,
    pin: req.body.pin,
    idempotencyKey: req.idempotencyKey,
    ...reqCtx(req),
  });
  res.status(201).json({ success: true, data, message: "Request paid." });
});

export const cancel = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await paymentRequestService.cancelRequest({
      userId: req.user.id,
      requestId: req.params.id,
      ...reqCtx(req),
    }),
  });
});