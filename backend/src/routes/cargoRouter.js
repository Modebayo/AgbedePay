// /api/cargo — Agbede Cargo quotation requests.
//
// Cargo is larger, non-instant freight: a request is a lead, not a payment.
// An admin prices it offline, so there is no wallet/ledger coupling here.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { cargoLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import { cargoRequestSchema, cargoIdParams } from "../validators/cargoSchemas.js";
import * as cargoController from "../controllers/cargoController.js";

const router = Router();

router.get("/requests", requireAuth, cargoController.list);

router.post(
  "/requests",
  requireAuth,
  cargoLimiter,
  validate(cargoRequestSchema),
  cargoController.create
);

router.get(
  "/requests/:id",
  requireAuth,
  validate(cargoIdParams, "params"),
  cargoController.detail
);

router.post(
  "/requests/:id/cancel",
  requireAuth,
  validate(cargoIdParams, "params"),
  cargoController.cancel
);

export default router;
