// /api/driver — the Agbede Driver vertical.
//
// Every route requires an authenticated user with role DRIVER. Drivers pump
// their own trips forward; completing one releases escrow and pays the driver.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../validators/validate.js";
import {
  availabilitySchema,
  kindIdParams,
  tripParams,
  completeSchema,
  driverApplySchema,
} from "../validators/driverSchemas.js";
import * as driverController from "../controllers/driverController.js";

const router = Router();

const driverOnly = [requireAuth, requireRole("DRIVER")];

// Any signed-in customer can apply; approval is what grants DRIVER-only access.
router.post("/apply", requireAuth, validate(driverApplySchema), driverController.apply);

router.get("/me", ...driverOnly, driverController.me);

router.patch(
  "/availability",
  ...driverOnly,
  validate(availabilitySchema),
  driverController.availability
);

router.get("/offers", ...driverOnly, driverController.offers);

router.post(
  "/offers/:kind/:id/accept",
  ...driverOnly,
  validate(kindIdParams, "params"),
  driverController.accept
);

router.post(
  "/offers/:kind/:id/decline",
  ...driverOnly,
  validate(kindIdParams, "params"),
  driverController.decline
);

router.get("/trips", ...driverOnly, driverController.trips);

router.post(
  "/trips/:kind/:id/:action",
  ...driverOnly,
  validate(tripParams, "params"),
  validate(completeSchema),
  driverController.trip
);

router.get("/earnings", ...driverOnly, driverController.earnings);

export default router;
