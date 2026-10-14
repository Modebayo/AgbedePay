// cargo controller — thin HTTP layer for Agbede Cargo quotation requests.

import { asyncHandler } from "../utils/errors.js";
import * as cargoService from "../services/cargoService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cargoService.list(req.user.id) });
});

export const create = asyncHandler(async (req, res) => {
  const data = await cargoService.submit({
    userId: req.user.id,
    input: req.body,
    ctx: reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});

export const detail = asyncHandler(async (req, res) => {
  const data = await cargoService.detail({ userId: req.user.id, id: req.params.id });
  res.json({ success: true, data });
});

export const cancel = asyncHandler(async (req, res) => {
  const data = await cargoService.cancel({
    userId: req.user.id,
    id: req.params.id,
    ctx: reqCtx(req),
  });
  res.json({ success: true, data });
});
