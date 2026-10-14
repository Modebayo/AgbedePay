// /api/payments — hosted-checkout wallet funding (Paystack first).
//
// The webhook route is intentionally unauthenticated: a gateway has no session.
// Its authenticity is enforced by the provider signature check in the service,
// which needs the raw request body captured by app.js.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { paymentsLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { paymentInitiateSchema, paymentReferenceSchema } from "../validators/paymentSchemas.js";
import * as paymentController from "../controllers/paymentController.js";

const router = Router();

// Provider webhooks (no auth, signature-verified inside the service).
router.post("/webhook", paymentController.webhook);
router.post("/webhook/:provider", paymentController.webhook);

router.get("/", requireAuth, paymentController.list);

router.post(
  "/initiate",
  requireAuth,
  paymentsLimiter,
  validate(paymentInitiateSchema),
  paymentController.initiate
);

router.post(
  "/verify",
  requireAuth,
  validate(paymentReferenceSchema),
  paymentController.verify
);

router.post(
  "/reconcile",
  requireAuth,
  requireRole("ADMIN"),
  validate(paymentReferenceSchema),
  paymentController.reconcile
);

export default router;
