// /api/wealth — Phase: invest. Stocks, funds, pension and treasury.
//
// Route order matters: static paths ("/overview") BEFORE parameterised ones
// ("/instruments/:id").
//
// Money movement (/orders/buy, /orders/sell) is guarded exactly like every
// other money move in the app: requireAuth, a rate limit, validated params,
// validated body, then a mandatory Idempotency-Key.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  buyOrderSchema,
  sellOrderSchema,
  instrumentIdParams,
  retirementGoalSchema,
  retirementGoalPatchSchema,
  goalIdParams,
} from "../validators/wealthSchemas.js";
import * as wealthController from "../controllers/wealthController.js";

const router = Router();

// ---- Read: all require a session (this is the customer's own money) ----
router.get("/overview", requireAuth, wealthController.overview);
router.get("/portfolio", requireAuth, wealthController.portfolio);
router.get("/instruments", requireAuth, wealthController.instruments);
// No `validate(..., "query")` here, deliberately. Query params arrive as
// strings, so an `int` rule can never pass; and the controller already parses
// page/limit and bounds-checks class/type with proper ApiError codes — the same
// approach savingsController and transferController use.
router.get("/history", requireAuth, wealthController.history);

// ---- Retirement goal ----
//
// No PIN, no rate limit, no Idempotency-Key, and none of them should ever be
// added here: a goal is a note to yourself. It moves no money, so there is
// nothing to double-charge and nothing to slow down. The one thing it does
// read is the portfolio, which the account already owns.
//
// `/retirement` is static and declared before `/instruments/:id` so the
// parameterised route can never swallow it.
router.get("/retirement", requireAuth, wealthController.retirementSummary);
router.post("/retirement", requireAuth, validate(retirementGoalSchema), wealthController.createRetirementGoal);
router.patch(
  "/retirement/:id",
  requireAuth,
  validate(goalIdParams, "params"),
  validate(retirementGoalPatchSchema),
  wealthController.updateRetirementGoal
);
router.delete(
  "/retirement/:id",
  requireAuth,
  validate(goalIdParams, "params"),
  wealthController.closeRetirementGoal
);

router.get(
  "/instruments/:id",
  requireAuth,
  validate(instrumentIdParams, "params"),
  wealthController.instrumentDetail
);

// ---- Write: money crosses the wallet ----
router.post(
  "/orders/buy",
  requireAuth,
  sendMoneyLimiter,
  validate(buyOrderSchema),
  requireIdempotencyKey,
  wealthController.buy
);

router.post(
  "/orders/sell",
  requireAuth,
  sendMoneyLimiter,
  validate(sellOrderSchema),
  requireIdempotencyKey,
  wealthController.sell
);

export default router;
