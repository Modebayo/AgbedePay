// ride service — business rules for Ride-Hailing.
//
// Mirrors the dispatch service: the client never sets a fare — the service
// recomputes distance + price from the addresses, holds the total (fare + an
// optional pre-paid tip) as a PENDING escrow, releases on completion and
// refunds on cancellation. Bargain offers are evaluated by the mock provider
// BEFORE anything is charged, so a declined offer never takes money.

import * as rideModel from "../models/rideModel.js";
import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as auditModel from "../models/audit.js";
import { notify } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import * as provider from "../providers/mockRideProvider.js";

// ---- Shared helpers ---------------------------------------------------------

async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) {
    throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
  }
}

const FAILURE_STATUS = {
  WALLET_FROZEN: [403, "Your wallet is frozen", "WALLET_FROZEN"],
  INSUFFICIENT_FUNDS: [400, "Insufficient balance for this ride"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [400, "Ride rejected", code];
  return new ApiError(status, message, outCode);
}

const STATUS_LABELS = {
  SEARCHING: "Looking for a driver",
  DRIVER_ACCEPTED: "Driver accepted",
  DRIVER_ARRIVING: "Driver arriving",
  IN_PROGRESS: "On your way",
  COMPLETED: "Trip completed",
  CANCELLED: "Cancelled",
};

const TIER_LABELS = { ECONOMY: "Economy", COMFORT: "Comfort", BARGAIN: "Bargain" };

function toApiBooking(b) {
  const breakdown = Array.isArray(b.fare_breakdown) ? b.fare_breakdown : [];
  const totalMinor = Number(b.amount_minor);
  return {
    id: b.id,
    tier: b.tier,
    tierLabel: TIER_LABELS[b.tier] ?? b.tier,
    passengers: b.passengers,
    pickupAddress: b.pickup_address,
    pickupContact: b.pickup_contact,
    dropoffAddress: b.dropoff_address,
    distanceKm: Number(b.distance_km),
    etaMin: b.est_duration_min,
    fareBreakdown: breakdown,
    totalMinor,
    totalNgn: formatNaira(totalMinor),
    tipMinor: Number(b.tip_minor ?? 0),
    tipNgn: formatNaira(b.tip_minor ?? 0),
    bargainOfferMinor: b.bargain_offer_minor ? Number(b.bargain_offer_minor) : null,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status] ?? b.status,
    driver: b.driver_name
      ? {
          name: b.driver_name,
          phone: b.driver_phone,
          car: b.driver_car,
          color: b.driver_color,
          plate: b.driver_plate,
          rating: Number(b.driver_rating) ?? null,
          trips: b.driver_trips ?? 0,
        }
      : null,
    contactForShare: b.contact_for_share ?? null,
    rating: b.rating ?? null,
    ratingTags: b.rating_tags ? String(b.rating_tags).split(",").filter(Boolean) : [],
    issueType: b.issue_type ?? null,
    issueNote: b.issue_note ?? null,
    reference: b.reference,
    transactionId: b.transaction_id,
    ledgerStatus: b.ledger_status ?? null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

// ---- Meta & quote ------------------------------------------------------------

export async function meta() {
  return { tiers: provider.listTiers() };
}

export async function quoteService({ tier, pickup, dropoff, passengers }) {
  const distanceKm = provider.distanceKmBetween(pickup, dropoff);
  const q = provider.quote({ tier, distanceKm, passengers });
  if (!q.ok) {
    throw new ApiError(400, "Too many passengers for this tier", "TOO_MANY_PASSENGERS");
  }
  return {
    distanceKm,
    etaMin: q.etaMin,
    surge: q.surge,
    fareBreakdown: q.breakdown,
    totalMinor: q.totalMinor,
    totalNgn: q.totalNgn,
  };
}

// ---- Booking ----------------------------------------------------------------

export async function createBooking({
  userId,
  tier,
  passengers,
  pickup,
  pickupContact,
  dropoff,
  bargainOfferMinor,
  tipMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const { distanceKm, etaMin, fareBreakdown, totalMinor } = await quoteService({
    tier,
    pickup,
    dropoff,
    passengers,
  });
  if (totalMinor <= 0) throw new ApiError(400, "Invalid fare", "VALIDATION_ERROR");

  // Bargain is decided BEFORE any debit: a declined offer never charges.
  if (tier === "BARGAIN") {
    if (!Number.isInteger(bargainOfferMinor) || bargainOfferMinor < 100) {
      throw new ApiError(400, "Bargain rides need a whole-naira offer", "VALIDATION_ERROR");
    }
    const decision = provider.evaluateBargain({ offerMinor: bargainOfferMinor, quoteMinor: totalMinor });
    if (!decision.accepted) {
      await auditModel.record({
        userId,
        action: "RIDE_BARGAIN_DECLINED",
        entityType: "RIDE_BOOKING",
        entityId: null,
        metadata: { offerMinor: bargainOfferMinor, quoteMinor: totalMinor },
        ipAddress,
        userAgent,
      });
      return {
        declined: true,
        notice: `Your offer of ${formatNaira(bargainOfferMinor)} was declined — try ${formatNaira(Math.round(totalMinor * 0.8))} or more.`,
        booking: null,
        balanceMinor: Number(wallet.balance_minor),
        balanceNgn: formatNaira(wallet.balance_minor),
      };
    }
  }

  const reference = generateReference("RIDE");

  // IDEMPOTENT REPLAY — same (wallet, key) already produced a result.
  const existing = await rideModel.findByWalletAndKey(wallet.id, idempotencyKey);
  if (existing) {
    return replay({ userId, wallet, found: existing, ipAddress, userAgent });
  }

  const tip = Number.isInteger(tipMinor) && tipMinor > 0 ? tipMinor : 0;
  const payable = totalMinor + tip;

  const result = await rideModel.executeBooking({
    userId,
    walletId: wallet.id,
    amountMinor: payable,
    reference,
    idempotencyKey,
    booking: {
      tier,
      passengers,
      pickupAddress: pickup,
      pickupContact,
      pickupLat: provider.coordsFor(pickup).lat,
      pickupLng: provider.coordsFor(pickup).lng,
      dropoffAddress: dropoff,
      dropoffLat: provider.coordsFor(dropoff).lat,
      dropoffLng: provider.coordsFor(dropoff).lng,
      distanceKm,
      estDurationMin: etaMin,
      fareBreakdown,
      tipMinor: tip,
      bargainOfferMinor: tier === "BARGAIN" ? bargainOfferMinor : null,
      narration: `Ride (${tier}) · ${pickup} → ${dropoff}${tip ? ` + ₦${(tip / 100).toFixed(2)} tip` : ""}`,
    },
  });

  // Lost a race: another request with this key committed first → replay theirs.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await rideModel.findByWalletAndKey(wallet.id, idempotencyKey);
    if (winner) return replay({ userId, wallet, found: winner, ipAddress, userAgent });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "RIDE_BOOKING_FAILED",
      entityType: "RIDE_BOOKING",
      entityId: null,
      metadata: { code: result.code, payable, tier },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "RIDE_BOOKED",
    entityType: "RIDE_BOOKING",
    entityId: result.booking.id,
    metadata: { reference, pickup, dropoff, tier, payable },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "RIDE",
    link: `ride.html?booking=${result.booking.id}`,
    title: `Ride booked · ${pickup} → ${dropoff}`,
    body: `${formatNaira(payable)} held for your ${TIER_LABELS[tier]} trip.`,
  });

  return {
    booking: toApiBooking({ ...result.booking, reference: result.ledger.reference }),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    declined: false,
    replayed: false,
  };
}

async function replay({ userId, wallet, found, ipAddress, userAgent }) {
  await auditModel.record({
    userId,
    action: "RIDE_BOOKING_REPLAYED",
    entityType: "RIDE_BOOKING",
    entityId: found.id ?? null,
    metadata: { reference: found.reference },
    ipAddress,
    userAgent,
  });
  const freshWallet = await walletModel.findByUserId(userId);

  if (found.ledger_status === "FAILED") {
    return {
      booking: null,
      notice: "This booking request was already processed and rejected.",
      failed: true,
      failureCode: found.failure_reason ?? null,
      balanceMinor: Number(freshWallet.balance_minor),
      balanceNgn: formatNaira(freshWallet.balance_minor),
      replayed: true,
    };
  }

  const booking = found.id ? await rideModel.findById(found.id) : null;
  return {
    booking: booking ? toApiBooking(booking) : null,
    notice: "This booking was already processed.",
    failed: false,
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: true,
  };
}

// ---- Listing & detail ---------------------------------------------------------

export async function listBookings(userId) {
  const rows = await rideModel.listByUser(userId);
  return { items: rows.map(toApiBooking) };
}

export async function getBooking({ userId, id }) {
  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }
  return { booking: toApiBooking(booking) };
}

// ---- Status machine ------------------------------------------------------------

const STEP_MAP = {
  ACCEPT: { from: "SEARCHING", to: "DRIVER_ACCEPTED", patches: (b) => provider.matchDriver(b.tier) },
  ARRIVE: { from: "DRIVER_ACCEPTED", to: "DRIVER_ARRIVING" },
  START: { from: "DRIVER_ARRIVING", to: "IN_PROGRESS" },
  COMPLETE: { from: "IN_PROGRESS", to: "COMPLETED" },
};

export async function advanceBooking({ userId, id, action, ipAddress, userAgent }) {
  const step = STEP_MAP[action];
  if (!step) throw new ApiError(400, "Unknown step", "VALIDATION_ERROR");

  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }

  const patches = step.patches ? step.patches(booking) : {};
  const result = await rideModel.advanceBooking({
    id,
    fromStatus: step.from,
    nextStatus: step.to,
    patches:
      step.patches
        ? {
            driverName: patches.name,
            driverPhone: patches.phone,
            driverCar: patches.car,
            driverColor: patches.color,
            driverPlate: patches.plate,
            driverRating: patches.rating,
            driverTrips: patches.trips,
          }
        : {},
  });

  if (!result.ok) {
    throw new ApiError(409, "This step is not available right now", "INVALID_STATE");
  }

  await auditModel.record({
    userId,
    action: step.to === "COMPLETED" ? "RIDE_COMPLETED" : "RIDE_ADVANCED",
    entityType: "RIDE_BOOKING",
    entityId: id,
    metadata: { action, status: step.to },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "RIDE",
    link: `ride.html?booking=${id}`,
    title: step.to === "COMPLETED" ? "Trip completed" : "Ride update",
    body: `${STATUS_LABELS[step.to]}${step.to === "COMPLETED" ? " — fare released." : "."}`,
  });

  return { booking: toApiBooking(await rideModel.findById(id)) };
}

// ---- Cancel / refund -----------------------------------------------------------

export async function cancelBooking({ userId, id, ipAddress, userAgent }) {
  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }

  const result = await rideModel.cancelBooking({
    id,
    reversableStatuses: ["SEARCHING", "DRIVER_ACCEPTED"],
    reversalReference: generateReference("RVS"),
  });

  if (!result.ok) {
    if (result.code === "WALLET_FROZEN") throw new ApiError(403, "Your wallet is frozen", "WALLET_FROZEN");
    throw new ApiError(409, "This ride can no longer be cancelled", "NOT_CANCELLABLE");
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "RIDE_CANCELLED",
    entityType: "RIDE_BOOKING",
    entityId: id,
    metadata: { refundedMinor: result.refundedMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "RIDE",
    link: `ride.html?booking=${id}`,
    title: "Ride cancelled",
    body: `${formatNaira(result.refundedMinor)} refunded to your wallet.`,
  });

  return {
    booking: toApiBooking(await rideModel.findById(id)),
    refundedMinor: result.refundedMinor,
    refundedNgn: formatNaira(result.refundedMinor),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
  };
}

// ---- Sharing, rating, issues -----------------------------------------------------

export async function shareLive({ userId, id, contact, ipAddress, userAgent }) {
  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) throw new ApiError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    throw new ApiError(409, "Live sharing is only available during a trip", "INVALID_STATE");
  }
  await rideModel.shareLive(id, contact);
  await auditModel.record({
    userId,
    action: "RIDE_SHARED_LIVE",
    entityType: "RIDE_BOOKING",
    entityId: id,
    metadata: { contact },
    ipAddress,
    userAgent,
  });
  await notify({
    userId,
    type: "RIDE",
    link: `ride.html?booking=${id}`,
    title: "Live trip shared",
    body: contact ? `Shared with ${contact}.` : "Live trip sharing is on.",
  });
  return { booking: toApiBooking(await rideModel.findById(id)) };
}

export async function rateBooking({ userId, id, rating, tags, ipAddress, userAgent }) {
  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) throw new ApiError(404, "Booking not found", "NOT_FOUND");
  if (booking.status !== "COMPLETED") throw new ApiError(409, "Only completed trips can be rated", "INVALID_STATE");
  await rideModel.rateBooking(id, rating, tags);
  await auditModel.record({
    userId,
    action: "RIDE_RATED",
    entityType: "RIDE_BOOKING",
    entityId: id,
    metadata: { rating, tags },
    ipAddress,
    userAgent,
  });
  return { booking: toApiBooking(await rideModel.findById(id)) };
}

export async function reportIssue({ userId, id, issueType, note, ipAddress, userAgent }) {
  const booking = await rideModel.findById(id);
  if (!booking || booking.user_id !== userId) throw new ApiError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED") throw new ApiError(409, "Cancelled trips cannot report issues", "INVALID_STATE");
  await rideModel.reportIssue(id, issueType, note);
  await auditModel.record({
    userId,
    action: "RIDE_ISSUE_REPORTED",
    entityType: "RIDE_BOOKING",
    entityId: id,
    metadata: { issueType, note },
    ipAddress,
    userAgent,
  });
  await notify({
    userId,
    type: "RIDE",
    link: `ride.html?booking=${id}`,
    title: "Issue reported",
    body: `We've flagged this trip for review (${issueType}).`,
  });
  return { booking: toApiBooking(await rideModel.findById(id)) };
}