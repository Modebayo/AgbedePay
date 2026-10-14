// /api/transactions — Phase 7: sending money, history, receipts, reversal.
//
// Route order matters: static paths ("/send") are registered BEFORE
// parameterised ones ("/:id"), so "/send" is never captured as an "id".

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  sendMoneySchema,
  sendToBankSchema,
  verifyBankAccountSchema,
  verifyAgbedeAccountSchema,
  requestMoneySchema,
  payRequestSchema,
  reverseSchema,
  transactionIdParams,
  requestIdParams,
} from "../validators/transferSchemas.js";
import * as transferController from "../controllers/transferController.js";
import * as requestController from "../controllers/requestController.js";

const router = Router();

// sendMoney requires, in order: a session, a rate limit, valid input, and an
// Idempotency-Key. The key turns a double-click into a single transfer.
router.post(
  "/send",
  requireAuth,
  sendMoneyLimiter,
  validate(sendMoneySchema),
  requireIdempotencyKey,
  transferController.send
);

// ---- Send to bank (OPay-style) ---- static paths BEFORE "/:id"
router.get("/banks", requireAuth, transferController.listBanks);
router.post(
  "/account/verify",
  requireAuth,
  validate(verifyBankAccountSchema),
  transferController.verifyBankAccount
);
router.post(
  "/account/verify/agbede",
  requireAuth,
  validate(verifyAgbedeAccountSchema),
  transferController.verifyAgbedeAccount
);
router.post(
  "/send/bank",
  requireAuth,
  sendMoneyLimiter,
  validate(sendToBankSchema),
  requireIdempotencyKey,
  transferController.sendToBank
);

// ---- Request money (OPay-style) ----
router.post("/request", requireAuth, validate(requestMoneySchema), requestController.request);
router.get("/requests", requireAuth, requestController.list);
router.post(
  "/requests/:id/pay",
  requireAuth,
  sendMoneyLimiter,
  validate(requestIdParams, "params"),
  validate(payRequestSchema),
  requireIdempotencyKey,
  requestController.pay
);
router.post(
  "/requests/:id/cancel",
  requireAuth,
  validate(requestIdParams, "params"),
  requestController.cancel
);

router.get("/", requireAuth, transferController.list);

router.get("/export", requireAuth, transferController.exportCsv);

router.get(
  "/:id",
  requireAuth,
  validate(transactionIdParams, "params"),
  transferController.detail
);

router.get(
  "/:id/receipt",
  requireAuth,
  validate(transactionIdParams, "params"),
  transferController.receipt
);

router.post(
  "/:id/reverse",
  requireAuth,
  sendMoneyLimiter,
  validate(transactionIdParams, "params"),
  validate(reverseSchema),
  transferController.reverse
);

export default router;