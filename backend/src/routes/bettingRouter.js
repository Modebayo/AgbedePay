// /api/betting/* routes — platforms + lookup + purchase.
// Static/catalog reads are cheap; the money-moving purchase is rate limited,
// validated and requires an Idempotency-Key (same rule as airtime/bills).

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  bettingLookupSchema,
  bettingPurchaseSchema,
} from "../validators/bettingSchemas.js";
import * as bettingController from "../controllers/bettingController.js";

const router = Router();

router.get("/providers", requireAuth, bettingController.list);

router.post(
  "/lookup",
  requireAuth,
  validate(bettingLookupSchema),
  bettingController.lookup
);

router.post(
  "/purchase",
  requireAuth,
  sendMoneyLimiter,
  validate(bettingPurchaseSchema),
  requireIdempotencyKey,
  bettingController.purchase
);

export default router;