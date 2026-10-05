// /api/kyc/* routes — bio data + identity verification. All protected.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { bioSchema, verifyIdentitySchema } from "../validators/kycSchemas.js";
import * as kycController from "../controllers/kycController.js";

const router = Router();

router.get("/", requireAuth, kycController.get);

router.get("/limits", requireAuth, kycController.limits);

router.put("/bio", requireAuth, validate(bioSchema), kycController.updateBio);

router.post(
  "/verify-identity",
  requireAuth,
  sendMoneyLimiter,
  validate(verifyIdentitySchema),
  kycController.verifyIdentity
);

export default router;