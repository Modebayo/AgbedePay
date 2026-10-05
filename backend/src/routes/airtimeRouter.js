// /api/airtime/* routes — providers + purchase. Money moves: rate limited,
// validated, Idempotency-Key required.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { purchaseAirtimeSchema } from "../validators/airtimeSchemas.js";
import * as airtimeController from "../controllers/airtimeController.js";

const router = Router();

router.get("/providers", requireAuth, airtimeController.list);

router.post(
  "/purchase",
  requireAuth,
  sendMoneyLimiter,
  validate(purchaseAirtimeSchema),
  requireIdempotencyKey,
  airtimeController.purchase
);

export default router;