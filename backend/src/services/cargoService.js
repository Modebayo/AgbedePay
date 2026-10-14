// cargo service — Agbede Cargo quotation requests.
//
// Cargo is larger, non-instant freight: no auto-pricing and no escrow. A
// customer submits a request; an admin reviews it and prices it offline. This
// service owns the customer side (submit, list, cancel) and shapes the API
// payload. No money moves.

import * as cargoModel from "../models/cargoQuotes.js";
import * as auditModel from "../models/audit.js";
import { notify } from "./notificationsService.js";
import { ApiError } from "../utils/errors.js";
import { generateReference } from "../utils/reference.js";
import { formatNaira } from "../utils/money.js";

const STATUS_LABELS = {
  REQUESTED: "Awaiting review",
  QUOTED: "Quote ready",
  ACCEPTED: "Accepted",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

function toApiQuote(q) {
  return {
    id: q.id,
    reference: q.reference,
    pickupAddress: q.pickup_address,
    dropoffAddress: q.dropoff_address,
    cargoType: q.cargo_type,
    approxWeightKg: q.approx_weight_kg === null ? null : Number(q.approx_weight_kg),
    dimensions: q.dimensions ?? null,
    vehicleRequirements: q.vehicle_requirements ?? null,
    collectionDate: q.collection_date ?? null,
    contactName: q.contact_name,
    contactPhone: q.contact_phone,
    notes: q.notes ?? null,
    status: q.status,
    statusLabel: STATUS_LABELS[q.status] ?? q.status,
    quotedAmountMinor: q.quoted_amount_minor === null ? null : Number(q.quoted_amount_minor),
    quotedAmountNgn: q.quoted_amount_minor === null ? null : formatNaira(q.quoted_amount_minor),
    adminNote: q.admin_note ?? null,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

export async function submit({ userId, input, ctx = {} }) {
  const quote = await cargoModel.create({
    userId,
    reference: generateReference("CGO"),
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    cargoType: input.cargoType,
    approxWeightKg: input.approxWeightKg,
    dimensions: input.dimensions,
    vehicleRequirements: input.vehicleRequirements,
    collectionDate: input.collectionDate,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    notes: input.notes,
  });

  await auditModel.record({
    userId,
    action: "CARGO_QUOTE_REQUESTED",
    entityType: "CARGO_QUOTE",
    entityId: quote.id,
    metadata: {
      reference: quote.reference,
      pickup: input.pickupAddress,
      dropoff: input.dropoffAddress,
      cargoType: input.cargoType,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  await notify({
    userId,
    type: "CARGO",
    link: `cargo.html?request=${quote.id}`,
    title: "Cargo request received",
    body: `We've got your ${quote.cargo_type.toLowerCase()} move from ${quote.pickup_address}. Our team will send a quote.`,
  });

  return { quote: toApiQuote(quote) };
}

export async function list(userId) {
  const rows = await cargoModel.listForUser(userId);
  return { items: rows.map(toApiQuote) };
}

export async function detail({ userId, id }) {
  const quote = await cargoModel.findById(id);
  if (!quote || quote.user_id !== userId) {
    throw new ApiError(404, "Cargo request not found", "NOT_FOUND");
  }
  return { quote: toApiQuote(quote) };
}

export async function cancel({ userId, id, ctx = {} }) {
  const quote = await cargoModel.findById(id);
  if (!quote || quote.user_id !== userId) {
    throw new ApiError(404, "Cargo request not found", "NOT_FOUND");
  }
  if (quote.status !== "REQUESTED") {
    throw new ApiError(409, "This request can no longer be cancelled", "NOT_CANCELLABLE");
  }

  const cancelled = await cargoModel.cancel({ id, userId });
  if (!cancelled) throw new ApiError(409, "This request can no longer be cancelled", "NOT_CANCELLABLE");

  await auditModel.record({
    userId,
    action: "CARGO_QUOTE_CANCELLED",
    entityType: "CARGO_QUOTE",
    entityId: id,
    metadata: { reference: cancelled.reference },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { quote: toApiQuote(cancelled) };
}
