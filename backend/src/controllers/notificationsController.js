// notifications controller — thin HTTP layer for the notice tray.

import { asyncHandler } from "../utils/errors.js";
import * as notificationService from "../services/notificationsService.js";

export const list = asyncHandler(async (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 50);
  const data = await notificationService.list({
    userId: req.user.id,
    limit,
    unreadOnly: req.query.unreadOnly === "true",
  });
  res.json({ success: true, data });
});

export const markOne = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await notificationService.markOneRead({ userId: req.user.id, notificationId: req.params.id }),
  });
});

export const markAll = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await notificationService.markAllRead({ userId: req.user.id }) });
});