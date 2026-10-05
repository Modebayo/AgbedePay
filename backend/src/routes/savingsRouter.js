// /api/savings — Phase 8: goals and deposits.
//
// Route order matters: static paths ("/goals") BEFORE parameterised ones ("/:id").

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  createGoalSchema,
  depositSchema,
  withdrawSchema,
  goalIdParams,
} from "../validators/savingsSchemas.js";
import * as savingsController from "../controllers/savingsController.js";

const router = Router();

router.post(
  "/goals",
  requireAuth,
  validate(createGoalSchema),
  savingsController.create
);

router.get("/goals", requireAuth, savingsController.list);

router.get(
  "/goals/:id",
  requireAuth,
  validate(goalIdParams, "params"),
  savingsController.detail
);

router.post(
  "/goals/:id/deposit",
  requireAuth,
  sendMoneyLimiter,
  validate(goalIdParams, "params"),
  validate(depositSchema),
  requireIdempotencyKey,
  savingsController.deposit
);

router.post(
  "/goals/:id/withdraw",
  requireAuth,
  sendMoneyLimiter,
  validate(goalIdParams, "params"),
  validate(withdrawSchema),
  requireIdempotencyKey,
  savingsController.withdraw
);

export default router;