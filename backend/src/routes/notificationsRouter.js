// /api/notifications — the in-app notice tray. Protected; ownership from session.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { validate } from "../validators/validate.js";
import * as notificationController from "../controllers/notificationsController.js";

const router = Router();

// notificationIdParams: id path params are UUIDs
export const notificationIdParams = {
  id: ["required", "string", "uuid"],
};

router.get("/", requireAuth, notificationController.list);
router.post("/read-all", requireAuth, notificationController.markAll);
router.post("/:id/read", requireAuth, validate(notificationIdParams, "params"), notificationController.markOne);

export default router;