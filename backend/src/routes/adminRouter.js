// /api/admin — the operator console.
//
// EVERY route here requires an authenticated ADMIN. The console reads across
// every module (users, wallets, ledger, rides, dispatch, drivers, cargo,
// payments, support) and can take a few corrective actions; role is enforced
// once at the router level so no individual route can forget it.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../validators/validate.js";
import {
  adminIdParams,
  driverStatusSchema,
  cargoQuoteSchema,
  supportReplySchema,
  reconcileParams,
} from "../validators/adminSchemas.js";
import * as adminController from "../controllers/adminController.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/overview", adminController.overview);

// Drivers
router.get("/drivers", adminController.listDrivers);
router.patch(
  "/drivers/:id",
  validate(adminIdParams, "params"),
  validate(driverStatusSchema),
  adminController.setDriverStatus
);

// Cargo
router.get("/cargo", adminController.listCargo);
router.patch(
  "/cargo/:id",
  validate(adminIdParams, "params"),
  validate(cargoQuoteSchema),
  adminController.quoteCargo
);

// Support
router.get("/support", adminController.listSupport);
router.post(
  "/support/:id/reply",
  validate(adminIdParams, "params"),
  validate(supportReplySchema),
  adminController.replySupport
);

// Payments
router.get("/payments", adminController.listPayments);
router.post(
  "/payments/:reference/reconcile",
  validate(reconcileParams, "params"),
  adminController.reconcilePayment
);

export default router;
