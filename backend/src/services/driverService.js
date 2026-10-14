// driver service — business rules for the Agbede Driver vertical.
//
// Drivers are users with role DRIVER + a driver_profiles row. They pump their
// own trips forward (accept → arrive → start → complete); the customer only
// watches. Completing a trip is where money moves: the customer's escrow is
// released and the driver is paid their net (gross − commission).

import * as driverModel from "../models/driverModel.js";
import * as auditModel from "../models/audit.js";
import { notify } from "./notificationsService.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";

const VEHICLE_LABELS = {
  CAR: "Car",
  VAN: "Van",
  BIKE: "Bike",
};

const ACTIVE_STATUSES = new Set([
  "DRIVER_ACCEPTED",
  "DRIVER_ARRIVING",
  "IN_PROGRESS",
  "RIDER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
]);

async function requireDriver(userId) {
  const profile = await driverModel.profileByUser(userId);
  if (!profile) throw new ApiError(403, "Driver profile not found", "NOT_A_DRIVER");
  return profile;
}

function toApiProfile(p) {
  return {
    userId: p.user_id,
    name: p.full_name,
    phone: p.phone,
    vehicleType: p.vehicle_type,
    vehicleLabel: VEHICLE_LABELS[p.vehicle_type] ?? p.vehicle_type,
    car: p.car_make_model,
    color: p.car_color,
    plate: p.plate_number,
    rating: Number(p.rating),
    trips: p.trips_completed,
    status: p.status,
    isOnline: p.is_online,
    lastSeenAt: p.last_seen_at,
    commissionBp: p.commission_bp,
  };
}

function driverPatch(p) {
  return {
    userId: p.user_id,
    name: p.full_name,
    phone: p.phone,
    car: p.car_make_model,
    color: p.car_color,
    plate: p.plate_number,
    rating: p.rating,
    trips: p.trips_completed,
  };
}

function bookingLink(kind, id) {
  return kind === "RIDE" ? `ride.html?booking=${id}` : `logistics.html?booking=${id}`;
}

// ---- Profile & availability -------------------------------------------------

export async function me(userId) {
  const profile = await requireDriver(userId);
  const summary = await driverModel.earningsSummary(userId);
  return {
    profile: toApiProfile(profile),
    earnings: {
      totalNetMinor: Number(summary.total_net_minor),
      totalNetNgn: formatNaira(summary.total_net_minor),
      trips: Number(summary.trips),
    },
  };
}

// ---- Self-service application ----------------------------------------------

// A signed-in customer applies to drive: we create a PENDING profile and flip
// their role to DRIVER in one step, then an admin approves it from the console.
export async function apply({ userId, input, ipAddress, userAgent }) {
  const existing = await driverModel.profileByUser(userId);
  if (existing) {
    throw new ApiError(409, "You've already applied to drive", "ALREADY_APPLIED");
  }

  const created = await driverModel.createApplication({
    userId,
    vehicleType: input.vehicleType,
    carMakeModel: input.carMakeModel,
    carColor: input.carColor,
    plateNumber: input.plateNumber,
  });
  // Losing the insert race to a duplicate application is the same outcome.
  if (!created) throw new ApiError(409, "You've already applied to drive", "ALREADY_APPLIED");

  await auditModel.record({
    userId,
    action: "DRIVER_APPLIED",
    entityType: "DRIVER",
    entityId: userId,
    metadata: { vehicleType: input.vehicleType, plate: input.plateNumber },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "SYSTEM",
    link: "driver.html",
    title: "Driver application received",
    body: "We're reviewing your details. You'll be able to go online once an admin approves your account.",
  });

  const profile = await driverModel.profileByUser(userId);
  return { applicationStatus: profile.status, profile: toApiProfile(profile) };
}

export async function setAvailability({ userId, isOnline, lat, lng }) {  const profile = await requireDriver(userId);
  if (isOnline && profile.status !== "ACTIVE") {
    throw new ApiError(403, "Your driver account is pending approval", "DRIVER_NOT_APPROVED");
  }
  const updated = await driverModel.setAvailability(userId, { isOnline, lat, lng });
  return { isOnline: updated.is_online, status: updated.status };
}

// ---- Offers -----------------------------------------------------------------

export async function listOffers(userId) {
  const profile = await requireDriver(userId);
  await driverModel.purgeExpiredOffers();
  const rows = await driverModel.listOffersAndOpen(userId, profile.vehicle_type);
  const now = Date.now();
  const items = rows.map((r) => {
    const expiresMs = r.expires_at ? new Date(r.expires_at).getTime() : null;
    return {
      kind: r.kind,
      bookingId: r.booking_id,
      label: r.label,
      pickupAddress: r.pickup_address,
      dropoffAddress: r.dropoff_address,
      distanceKm: Number(r.distance_km),
      etaMin: r.est_duration_min,
      amountMinor: Number(r.amount_minor),
      amountNgn: formatNaira(r.amount_minor),
      status: r.booking_status,
      open: r.offer_status === "OPEN",
      expiresAt: r.expires_at,
      secondsLeft: expiresMs ? Math.max(0, Math.round((expiresMs - now) / 1000)) : null,
    };
  });
  return { items, profile: toApiProfile(profile) };
}

export async function acceptOffer({ userId, kind, id, ipAddress, userAgent }) {
  const profile = await requireDriver(userId);
  if (profile.status !== "ACTIVE") {
    throw new ApiError(403, "Your driver account is pending approval", "DRIVER_NOT_APPROVED");
  }
  const result = await driverModel.acceptBooking({
    kind,
    bookingId: id,
    driver: driverPatch(profile),
  });
  if (!result.ok) throw new ApiError(409, "This job was just taken", "ALREADY_TAKEN");

  await auditModel.record({
    userId,
    action: "DRIVER_ACCEPTED_JOB",
    entityType: `${kind}_BOOKING`,
    entityId: id,
    metadata: { kind },
    ipAddress,
    userAgent,
  });
  await notify({
    userId: result.booking.user_id,
    type: kind,
    link: bookingLink(kind, id),
    title: kind === "RIDE" ? "Driver on the way" : "Rider on the way",
    body: `${profile.full_name} accepted your ${kind === "RIDE" ? "ride" : "delivery"}.`,
  });
  return { kind, bookingId: id, status: result.booking.status };
}

export async function declineOffer({ userId, kind, id }) {
  await requireDriver(userId);
  await driverModel.markOfferResponded({
    kind,
    bookingId: id,
    driverUserId: userId,
    status: "DECLINED",
  });
  return { declined: true };
}

// ---- Trip progression -------------------------------------------------------

const ADVANCE_MSG = {
  RIDE: {
    arrived: ["Driver arrived", "Your driver has arrived at the pickup."],
    start: ["Trip started", "You're on your way."],
  },
  DISPATCH: {
    pickup: ["Picked up", "Your package has been picked up."],
    transit: ["In transit", "Your package is on the way."],
  },
};

export async function advance({ userId, kind, id, action, ipAddress, userAgent }) {
  await requireDriver(userId);
  const result = await driverModel.advanceTransition({
    kind,
    bookingId: id,
    driverUserId: userId,
    action,
  });
  if (!result.ok) {
    throw new ApiError(
      409,
      "This action is not available right now",
      result.code === "UNKNOWN_ACTION" ? "VALIDATION_ERROR" : "INVALID_STATE"
    );
  }
  const msg = ADVANCE_MSG[kind]?.[action];
  if (msg) {
    await notify({
      userId: result.booking.user_id,
      type: kind,
      link: bookingLink(kind, id),
      title: msg[0],
      body: msg[1],
    });
  }
  await auditModel.record({
    userId,
    action: "DRIVER_TRIP_ADVANCED",
    entityType: `${kind}_BOOKING`,
    entityId: id,
    metadata: { action },
    ipAddress,
    userAgent,
  });
  return { kind, bookingId: id, status: result.booking.status };
}

// Complete (ride) / deliver (dispatch): the terminal step that pays the driver.
export async function complete({ userId, kind, id, otpCode, ipAddress, userAgent }) {
  await requireDriver(userId);
  const result = await driverModel.settleBooking({
    kind,
    bookingId: id,
    driverUserId: userId,
    otpCode,
    reference: generateReference("EARN"),
  });
  if (!result.ok) {
    const map = {
      INVALID_STATE: [409, "This trip can't be completed yet", "INVALID_STATE"],
      INVALID_OTP: [400, "Incorrect delivery code", "INVALID_OTP"],
      DRIVER_WALLET_MISSING: [409, "Your wallet isn't ready yet", "WALLET_MISSING"],
    };
    const [status, message, code] = map[result.code] ?? [400, "Unable to complete the trip", result.code];
    throw new ApiError(status, message, code);
  }

  await auditModel.record({
    userId,
    action: kind === "RIDE" ? "DRIVER_TRIP_COMPLETED" : "DRIVER_DELIVERY_COMPLETED",
    entityType: `${kind}_BOOKING`,
    entityId: id,
    metadata: { gross: result.gross, commission: result.commission, net: result.net },
    ipAddress,
    userAgent,
  });
  await notify({
    userId: result.booking.user_id,
    type: kind,
    link: bookingLink(kind, id),
    title: kind === "RIDE" ? "Trip completed" : "Delivered",
    body: kind === "RIDE" ? "Thanks for riding with Agbede." : "Your delivery is complete.",
  });
  return {
    kind,
    bookingId: id,
    status: result.booking.status,
    grossMinor: result.gross,
    commissionMinor: result.commission,
    netMinor: result.net,
    netNgn: formatNaira(result.net),
  };
}

// ---- History & earnings -----------------------------------------------------

export async function trips(userId) {
  await requireDriver(userId);
  const rows = await driverModel.listTrips(userId, 50);
  const items = rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    label: r.label,
    status: r.status,
    active: ACTIVE_STATUSES.has(r.status),
    pickupAddress: r.pickup_address,
    dropoffAddress: r.dropoff_address,
    distanceKm: Number(r.distance_km),
    amountMinor: Number(r.amount_minor),
    amountNgn: formatNaira(r.amount_minor),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return { items };
}

export async function earnings(userId) {
  await requireDriver(userId);
  const summary = await driverModel.earningsSummary(userId);
  const items = await driverModel.listEarnings(userId, 50);
  return {
    totalNetMinor: Number(summary.total_net_minor),
    totalNetNgn: formatNaira(summary.total_net_minor),
    totalCommissionMinor: Number(summary.total_commission_minor),
    totalCommissionNgn: formatNaira(summary.total_commission_minor),
    trips: Number(summary.trips),
    items: items.map((e) => ({
      id: e.id,
      kind: e.booking_kind,
      bookingId: e.booking_id,
      grossMinor: Number(e.gross_minor),
      grossNgn: formatNaira(e.gross_minor),
      commissionMinor: Number(e.commission_minor),
      netMinor: Number(e.net_minor),
      netNgn: formatNaira(e.net_minor),
      status: e.status,
      createdAt: e.created_at,
    })),
  };
}
