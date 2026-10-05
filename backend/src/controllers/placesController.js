// places controller — saved pickup/dropoff favourites (Home, Office, …).

import { asyncHandler } from "../utils/errors.js";
import * as placesService from "../services/placesService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (req, res) => {
  const data = await placesService.list(req.user.id);
  res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const data = await placesService.create({ ...req.body, userId: req.user.id, ...reqCtx(req) });
  res.status(201).json({ success: true, data });
});