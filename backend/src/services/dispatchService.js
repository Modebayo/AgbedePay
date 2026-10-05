// dispatch service — business rules for Logistics & Dispatch.
//
// What lives here:
//   - "who may do this" checks (ownership, the caller's PIN)
//   - SERVER-side fare computation — the quote may look advisory, but the
//     booking service recomputes distance + fare from the same two addresses,
//     so nothing the client says about money is ever trusted
//   - idempotent replay (return the stored outcome instead of charging twice)
//   - the status machine (every move is a validated transition)
// All money is INTEGER kobo; formatted only at the edge.

import * as dispatchModel from "../models/dispatchModel.js";
import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as auditModel from "../models/audit.js";
import { notify } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import * as provider from "../providers/mockDispatchProvider.js";

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
  INSUFFICIENT_FUNDS: [400, "Insufficient balance for this booking"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [400, "Booking rejected", code];
  return new ApiError(status, message, outCode);
}

const STATUS_LABELS = {
  BOOKED: "Order placed",
  RIDER_ASSIGNED: "Rider assigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

function toApiBooking(b) {
  const breakdown = Array.isArray(b.fare_breakdown) ? b.fare_breakdown : b.fare_breakdown?.lines ?? [];
  return {
    id: b.id,
    serviceType: b.service_type,
    itemType: b.item_type,
    vehicleType: b.vehicle_type,
    pickupAddress: b.pickup_address,
    pickupContact: b.pickup_contact,
    dropoffAddress: b.dropoff_address,
    dropoffContact: b.dropoff_contact,
    distanceKm: Number(b.distance_km),
    etaMin: b.est_duration_min,
    fareBreakdown: breakdown,
    totalMinor: Number(b.amount_minor),
    totalNgn: formatNaira(b.amount_minor),
    status: b.status,
    statusLabel: STATUS_LABELS[b.status] ?? b.status,
    rider: b.rider_name
      ? {
          name: b.rider_name,
          phone: b.rider_phone,
          vehicle: b.rider_vehicle,
          plate: b.rider_plate,
          rating: Number(b.rider_rating) ?? null,
          trips: b.rider_trips ?? 0,
        }
      : null,
    rating: b.rating ?? null,
    ratingTags: b.rating_tags ? String(b.rating_tags).split(",").filter(Boolean) : [],
    issueType: b.issue_type ?? null,
    issueNote: b.issue_note ?? null,
    reference: b.reference,
    transactionId: b.transaction_id,
    ledgerStatus: b.ledger_status ?? null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    // DEV/MOCK: only this app knows the delivery code — the "courier" is fake.
    devMock: { deliveryCode: provider.otpFromReference(b.reference).code },
  };
}

// ---- Meta & quote ------------------------------------------------------------

export async function meta() {
  return {
    itemTypes: provider.listItemTypes(),
    vehicles: provider.listVehicles(),
  };
}

export async function quoteService({ pickup, dropoff, itemType, vehicleType, serviceType }) {
  const distanceKm = provider.distanceKmBetween(pickup, dropoff);
  const q = provider.quote({ itemType, vehicleType, distanceKm, serviceType });
  if (!q.ok) {
    throw new ApiError(400, "This vehicle cannot carry that item", "VEHICLE_CANNOT_CARRY");
  }
  return {
    distanceKm,
    etaMin: q.etaMin,
    fareBreakdown: q.breakdown,
    totalMinor: q.totalMinor,
    totalNgn: q.totalNgn,
  };
}

// ---- Booking ----------------------------------------------------------------

export async function createBooking({
  userId,
  serviceType,
  itemType,
  vehicleType,
  pickup,
  pickupContact,
  dropoff,
  dropoffContact,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  // The fare is recomputed here, server-side, from the addresses alone.
  const { distanceKm, etaMin, fareBreakdown, totalMinor } = await quoteService({
    pickup,
    dropoff,
    itemType,
    vehicleType,
    serviceType,
  });
  if (totalMinor <= 0) throw new ApiError(400, "Invalid fare", "VALIDATION_ERROR");

  const reference = generateReference("DPK");

  // IDEMPOTENT REPLAY — same (wallet, key) already produced a result.
  const existing = await dispatchModel.findByWalletAndKey(wallet.id, idempotencyKey);
  if (existing) {
    return replay({ userId, wallet, found: existing, ipAddress, userAgent });
  }

  const otp = provider.otpFromReference(reference);

  const result = await dispatchModel.executeBooking({
    userId,
    walletId: wallet.id,
    amountMinor: totalMinor,
    reference,
    idempotencyKey,
    deliveryOtpHash: otp.hash,
    booking: {
      serviceType,
      itemType,
      vehicleType,
      pickupAddress: pickup,
      pickupContact,
      pickupLat: provider.coordsFor(pickup).lat,
      pickupLng: provider.coordsFor(pickup).lng,
      dropoffAddress: dropoff,
      dropoffContact,
      dropoffLat: provider.coordsFor(dropoff).lat,
      dropoffLng: provider.coordsFor(dropoff).lng,
      distanceKm,
      estDurationMin: etaMin,
      fareBreakdown,
      narration: `Package delivery · ${pickup} → ${dropoff}`,
    },
  });

  // Lost a race: another request with this key committed first → replay theirs.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await dispatchModel.findByWalletAndKey(wallet.id, idempotencyKey);
    if (winner) return replay({ userId, wallet, found: winner, ipAddress, userAgent });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "DISPATCH_BOOKING_FAILED",
      entityType: "DISPATCH_BOOKING",
      entityId: null,
      metadata: { code: result.code, totalMinor, itemType },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "DISPATCH_BOOKED",
    entityType: "DISPATCH_BOOKING",
    entityId: result.booking.id,
    metadata: { reference, pickup, dropoff, totalMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "DISPATCH",
    link: `logistics.html?booking=${result.booking.id}`,
    title: `Pickup booked · ${pickup} → ${dropoff}`,
    body: `${formatNaira(totalMinor)} held for your ${itemType.toLowerCase()} delivery.`,
  });

  return {
    booking: toApiBooking({ ...result.booking, reference: result.ledger.reference }),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: false,
  };
}

async function replay({ userId, wallet, found, ipAddress, userAgent }) {
  await auditModel.record({
    userId,
    action: "DISPATCH_BOOKING_REPLAYED",
    entityType: "DISPATCH_BOOKING",
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

  const booking = found.id ? await dispatchModel.findById(found.id) : null;
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
  const rows = await dispatchModel.listByUser(userId);
  return { items: rows.map(toApiBooking) };
}

export async function getBooking({ userId, id }) {
  const booking = await dispatchModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }
  return { booking: toApiBooking(booking) };
}

// ---- Status machine ------------------------------------------------------------

const STEP_MAP = {
  ASSIGN: { from: "BOOKED", to: "RIDER_ASSIGNED", patches: (b) => provider.assignRider(b.vehicle_type) },
  PICKUP: { from: "RIDER_ASSIGNED", to: "PICKED_UP" },
  TRANSIT: { from: "PICKED_UP", to: "IN_TRANSIT" },
  DELIVER: { from: "IN_TRANSIT", to: "DELIVERED", needsOtp: true },
};

export async function advanceBooking({ userId, id, action, otp, ipAddress, userAgent }) {
  const step = STEP_MAP[action];
  if (!step) throw new ApiError(400, "Unknown step", "VALIDATION_ERROR");

  const booking = await dispatchModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }

  const patches = step.patches ? step.patches(booking) : {};
  const result = await dispatchModel.advanceBooking({
    id,
    fromStatus: step.from,
    nextStatus: step.to,
    otpCode: step.needsOtp ? otp : null,
    patches:
      step.patches
        ? {
            riderName: patches.name,
            riderPhone: patches.phone,
            riderVehicle: patches.vehicle,
            riderPlate: patches.plate,
            riderRating: patches.rating,
            riderTrips: patches.trips,
          }
        : {},
  });

  if (!result.ok) {
    if (result.code === "INVALID_OTP") {
      throw new ApiError(400, "Incorrect delivery code", "INVALID_OTP");
    }
    throw new ApiError(409, "This step is not available right now", "INVALID_STATE");
  }

  await auditModel.record({
    userId,
    action: step.to === "DELIVERED" ? "DISPATCH_DELIVERED" : "DISPATCH_ADVANCED",
    entityType: "DISPATCH_BOOKING",
    entityId: id,
    metadata: { action, status: step.to },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "DISPATCH",
    link: `logistics.html?booking=${id}`,
    title: step.to === "DELIVERED" ? "Package delivered" : "Delivery update",
    body: `${STATUS_LABELS[step.to]} · ${formatNaira(result.booking.amount_minor)} released${step.to === "DELIVERED" ? "." : " (still held)."}`,
  });

  return { booking: toApiBooking(await dispatchModel.findById(id)) };
}

// ---- Cancel / refund -----------------------------------------------------------

export async function cancelBooking({ userId, id, ipAddress, userAgent }) {
  const booking = await dispatchModel.findById(id);
  if (!booking || booking.user_id !== userId) {
    throw new ApiError(404, "Booking not found", "NOT_FOUND");
  }

  const result = await dispatchModel.cancelBooking({
    id,
    reversableStatuses: ["BOOKED", "RIDER_ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
    reversalReference: generateReference("RVS"),
  });

  if (!result.ok) {
    if (result.code === "WALLET_FROZEN") throw new ApiError(403, "Your wallet is frozen", "WALLET_FROZEN");
    throw new ApiError(409, "This booking can no longer be cancelled", "NOT_CANCELLABLE");
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "DISPATCH_CANCELLED",
    entityType: "DISPATCH_BOOKING",
    entityId: id,
    metadata: { refundedMinor: result.refundedMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "DISPATCH",
    link: `logistics.html?booking=${id}`,
    title: "Pickup cancelled",
    body: `${formatNaira(result.refundedMinor)} refunded to your wallet.`,
  });

  return {
    booking: toApiBooking(await dispatchModel.findById(id)),
    refundedMinor: result.refundedMinor,
    refundedNgn: formatNaira(result.refundedMinor),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
  };
}

// ---- Rating & issues ------------------------------------------------------------

export async function rateBooking({ userId, id, rating, tags, ipAddress, userAgent }) {
  const booking = await dispatchModel.findById(id);
  if (!booking || booking.user_id !== userId) throw new ApiError(404, "Booking not found", "NOT_FOUND");
  if (booking.status !== "DELIVERED") throw new ApiError(409, "Only delivered orders can be rated", "INVALID_STATE");
  const updated = await dispatchModel.rateBooking(id, rating, tags);
  await auditModel.record({
    userId,
    action: "DISPATCH_RATED",
    entityType: "DISPATCH_BOOKING",
    entityId: id,
    metadata: { rating, tags },
    ipAddress,
    userAgent,
  });
  return { booking: toApiBooking(await dispatchModel.findById(id)) };
}

export async function reportIssue({ userId, id, issueType, note, ipAddress, userAgent }) {
  const booking = await dispatchModel.findById(id);
  if (!booking || booking.user_id !== userId) throw new ApiError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED") throw new ApiError(409, "Cancelled orders cannot report issues", "INVALID_STATE");
  const updated = await dispatchModel.reportIssue(id, issueType, note);
  await auditModel.record({
    userId,
    action: "DISPATCH_ISSUE_REPORTED",
    entityType: "DISPATCH_BOOKING",
    entityId: id,
    metadata: { issueType, note },
    ipAddress,
    userAgent,
  });
  await notify({
    userId,
    type: "DISPATCH",
    link: `logistics.html?booking=${id}`,
    title: "Issue reported",
    body: `We've flagged this delivery for review (${issueType}).`,
  });
  return { booking: toApiBooking(await dispatchModel.findById(id)) };
}