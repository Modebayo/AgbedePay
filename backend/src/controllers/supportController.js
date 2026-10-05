// support controller — thin HTTP layer for Help & Support tickets.

import { asyncHandler } from "../utils/errors.js";
import * as supportService from "../services/supportService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await supportService.listTickets(req.user.id) });
});

export const create = asyncHandler(async (req, res) => {
  const data = await supportService.createTicket({
    userId: req.user.id,
    category: req.body.category,
    subject: req.body.subject,
    message: req.body.message,
    ctx: reqCtx(req),
  });
  res.status(201).json({ success: true, data });
});
