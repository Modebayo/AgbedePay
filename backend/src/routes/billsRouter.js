// /api/bills/* routes — electricity, mobile data, cable TV.
// Static/catalog reads are cheap; every money-moving route is rate limited,
// validated and requires an Idempotency-Key (same rule as transfers/airtime).

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  purchaseElectricitySchema,
  purchaseDataSchema,
  purchaseCableSchema,
  cableLookupSchema,
} from "../validators/billsSchemas.js";
import * as billsController from "../controllers/billsController.js";

const router = Router();

router.get("/providers", requireAuth, billsController.list);

router.post(
  "/electricity",
  requireAuth,
  sendMoneyLimiter,
  validate(purchaseElectricitySchema),
  requireIdempotencyKey,
  billsController.electricity
);

router.post(
  "/data",
  requireAuth,
  sendMoneyLimiter,
  validate(purchaseDataSchema),
  requireIdempotencyKey,
  billsController.data
);

router.post(
  "/cable/lookup",
  requireAuth,
  validate(cableLookupSchema),
  billsController.cableLookup
);

router.post(
  "/cable",
  requireAuth,
  sendMoneyLimiter,
  validate(purchaseCableSchema),
  requireIdempotencyKey,
  billsController.cableSubscribe
);

export default router;