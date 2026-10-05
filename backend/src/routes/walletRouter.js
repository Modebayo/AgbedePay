// /api/wallet — the live balance for the logged-in user.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { fundWalletSchema } from "../validators/walletSchemas.js";
import * as walletController from "../controllers/walletController.js";

const router = Router();

// Protected: reads req.user.id from the session. A client can never ask for
// someone else's wallet — there is no :userId parameter to tamper with.
router.get("/", requireAuth, walletController.getWallet);

// Money in. Simulated gateway, real ledger credit. Idempotency → single credit.
router.post(
  "/fund",
  requireAuth,
  sendMoneyLimiter,
  validate(fundWalletSchema),
  requireIdempotencyKey,
  walletController.fund
);

export default router;