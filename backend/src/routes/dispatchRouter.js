// /api/dispatch — Logistics & Dispatch (package delivery + errand service).
//
// Route order matters: static paths before parameterised ones.
// Money moves only on POST /bookings (sendMoneyLimiter + Idempotency-Key);
// quotes, status steps, ratings and issues are read/state, not money.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import { sendMoneyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../validators/validate.js";
import {
  quoteSchema,
  createBookingSchema,
  advanceSchema,
  rateSchema,
  issueSchema,
  bookingIdParams,
} from "../validators/dispatchSchemas.js";
import * as dispatchController from "../controllers/dispatchController.js";

const router = Router();

router.get("/meta", requireAuth, dispatchController.meta);

router.post("/quote", requireAuth, validate(quoteSchema), dispatchController.quote);

router.get("/bookings", requireAuth, dispatchController.list);

router.post(
  "/bookings",
  requireAuth,
  sendMoneyLimiter,
  validate(createBookingSchema),
  requireIdempotencyKey,
  dispatchController.create
);

router.get(
  "/bookings/:id",
  requireAuth,
  validate(bookingIdParams, "params"),
  dispatchController.detail
);

router.post(
  "/bookings/:id/advance",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(advanceSchema),
  dispatchController.advance
);

router.post(
  "/bookings/:id/cancel",
  requireAuth,
  validate(bookingIdParams, "params"),
  dispatchController.cancel
);

router.post(
  "/bookings/:id/rate",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(rateSchema),
  dispatchController.rate
);

router.post(
  "/bookings/:id/issue",
  requireAuth,
  validate(bookingIdParams, "params"),
  validate(issueSchema),
  dispatchController.issue
);

export default router;