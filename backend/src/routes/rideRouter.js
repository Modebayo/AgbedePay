// /api/ride — Ride-Hailing (Economy / Comfort / Bargain).
//
// Only POST /bookings moves money (sendMoneyLimiter + Idempotency-Key).
// Bargain offers are decided by the provider before any debit.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  quoteSchema,
  createBookingSchema,
  advanceSchema,
  shareSchema,
  rateSchema,
  issueSchema,
  bookingIdParams,
} from "../validators/rideSchemas.js";
import * as rideController from "../controllers/rideController.js";

const router = Router();

router.get("/meta", requireAuth, rideController.meta);

router.post("/quote", requireAuth, validate(quoteSchema), rideController.quote);

router.get("/bookings", requireAuth, rideController.list);

router.post(
  "/bookings",
  requireAuth,
  sendMoneyLimiter,
  validate(createBookingSchema),
  requireIdempotencyKey,
  rideController.create
);

router.get(
  "/bookings/:id",
  requireAuth,
  validate(bookingIdParams, "params"),
  rideController.detail
);

router.post(
  "/bookings/:id/advance",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(advanceSchema),
  rideController.advance
);

router.post(
  "/bookings/:id/cancel",
  requireAuth,
  validate(bookingIdParams, "params"),
  rideController.cancel
);

router.post(
  "/bookings/:id/share-live",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(shareSchema),
  rideController.share
);

router.post(
  "/bookings/:id/rate",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(rateSchema),
  rideController.rate
);

router.post(
  "/bookings/:id/issue",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(issueSchema),
  rideController.issue
);

export default router;