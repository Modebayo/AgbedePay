// /api/withdraw — linked bank accounts and cash-outs to them.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { addAccountSchema, accountIdParams, withdrawSchema } from "../validators/withdrawSchemas.js";
import * as withdrawController from "../controllers/withdrawController.js";
import { supportedBanks, supportedAgentNetworks } from "../services/withdrawService.js";

const router = Router();

router.get("/bases", requireAuth, (_req, res) =>
  res.json({ success: true, data: { banks: supportedBanks(), agentNetworks: supportedAgentNetworks() } })
);

router.get("/accounts", requireAuth, withdrawController.listAccounts);
router.post("/accounts", requireAuth, validate(addAccountSchema), withdrawController.addAccount);
router.delete("/accounts/:id", requireAuth, validate(accountIdParams, "params"), withdrawController.removeAccount);

// Money OUT. Debits the wallet + writes the WITHDRAWAL ledger row. Same
// idempotency discipline as every other money move.
router.post(
  "/",
  requireAuth,
  sendMoneyLimiter,
  validate(withdrawSchema),
  requireIdempotencyKey,
  withdrawController.withdraw
);

export default router;