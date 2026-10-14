// admin service — business rules for the admin console.
//
// The console is read-mostly: an operator looks at the whole platform, then
// takes a small number of actions (approve/suspend a driver, price a cargo
// request, answer a support ticket, reconcile a payment). Every mutation is
// audited and, where a customer/driver is affected, announced in their in-app
// notification tray. Controllers stay thin; all "deciding" lives here.

import * as adminModel from "../models/adminModel.js";
import * as driverModel from "../models/driverModel.js";
import * as cargoModel from "../models/cargoQuotes.js";
import * as supportModel from "../models/supportTickets.js";
import * as paymentModel from "../models/payments.js";
import * as auditModel from "../models/audit.js";
import * as paymentService from "./paymentService.js";
import { notify } from "./notificationsService.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";

// BIGINT sums come back from pg as strings; normalise before formatting.
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const ngn = (minor) => formatNaira(num(minor));

const CARGO_STATUS_LABELS = {
  REQUESTED: "Awaiting review",
  QUOTED: "Quote ready",
  ACCEPTED: "Accepted",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

// ---------- Overview ----------

export async function overview() {
  const [o, recent] = await Promise.all([adminModel.overview(), adminModel.recentActivity()]);

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: o.users.total,
      active: o.users.active,
      suspended: o.users.suspended,
      pending: o.users.pending,
      drivers: o.users.drivers,
      admins: o.users.admins,
      new7d: o.users.new_7d,
    },
    wallets: {
      total: o.wallets.total,
      frozen: o.wallets.frozen,
      totalBalanceMinor: num(o.wallets.total_balance_minor),
      totalBalanceNgn: ngn(o.wallets.total_balance_minor),
    },
    transactions: {
      total: o.transactions.total,
      success: o.transactions.success,
      failed: o.transactions.failed,
      pending: o.transactions.pending,
      today: o.transactions.today,
      volume7dMinor: num(o.transactions.volume_7d_minor),
      volume7dNgn: ngn(o.transactions.volume_7d_minor),
      volumeAllMinor: num(o.transactions.volume_all_minor),
      volumeAllNgn: ngn(o.transactions.volume_all_minor),
      byType: (o.txByType ?? []).map((r) => ({
        type: r.type,
        count: r.count,
        amountMinor: num(r.amount_minor),
        amountNgn: ngn(r.amount_minor),
      })),
    },
    rides: {
      total: o.rides.total,
      active: o.rides.active,
      completed: o.rides.completed,
      cancelled: o.rides.cancelled,
    },
    dispatch: {
      total: o.dispatch.total,
      active: o.dispatch.active,
      delivered: o.dispatch.delivered,
      cancelled: o.dispatch.cancelled,
    },
    drivers: {
      total: o.drivers.total,
      pending: o.drivers.pending,
      active: o.drivers.active,
      suspended: o.drivers.suspended,
      online: o.drivers.online,
    },
    cargo: {
      total: o.cargo.total,
      requested: o.cargo.requested,
      quoted: o.cargo.quoted,
      accepted: o.cargo.accepted,
      closed: o.cargo.closed,
    },
    payments: {
      total: o.payments.total,
      pending: o.payments.pending,
      success: o.payments.success,
      failed: o.payments.failed,
      collectedMinor: num(o.payments.collected_minor),
      collectedNgn: ngn(o.payments.collected_minor),
    },
    support: {
      total: o.support.total,
      open: o.support.open,
      inProgress: o.support.in_progress,
      resolved: o.support.resolved,
    },
    recent: {
      transactions: recent.transactions.map((t) => ({
        id: t.id,
        reference: t.reference,
        type: t.type,
        status: t.status,
        amountMinor: num(t.amount_minor),
        amountNgn: formatNaira(t.amount_minor),
        userName: t.user_name,
        createdAt: t.created_at,
      })),
      users: recent.users.map((u) => ({
        id: u.id,
        name: u.full_name,
        phone: u.phone,
        role: u.role,
        status: u.status,
        createdAt: u.created_at,
      })),
    },
  };
}

// ---------- Drivers ----------

function toApiDriver(d) {
  return {
    userId: d.user_id,
    name: d.full_name,
    phone: d.phone,
    email: d.email ?? null,
    vehicleType: d.vehicle_type,
    vehicle: [d.car_make_model, d.car_color].filter(Boolean).join(" · "),
    plate: d.plate_number,
    commissionBp: d.commission_bp,
    commissionPct: `${(d.commission_bp / 100).toFixed(1)}%`,
    rating: d.rating === null || d.rating === undefined ? null : Number(d.rating),
    tripsCompleted: d.trips_completed,
    status: d.status,
    isOnline: Boolean(d.is_online),
    joinedAt: d.joined_at ?? d.created_at,
    updatedAt: d.updated_at,
  };
}

export async function listDrivers({ status = null } = {}) {
  const rows = await driverModel.listProfiles({ status: status ?? null });
  return { items: rows.map(toApiDriver) };
}

export async function setDriverStatus({ adminId, userId, status, ctx = {} }) {
  if (!["ACTIVE", "SUSPENDED", "PENDING"].includes(status)) {
    throw new ApiError(400, "Invalid driver status", "VALIDATION");
  }

  const updated = await driverModel.setStatus({ userId, status });
  if (!updated) throw new ApiError(404, "Driver not found", "NOT_FOUND");

  const action =
    status === "ACTIVE" ? "DRIVER_APPROVED" : status === "SUSPENDED" ? "DRIVER_SUSPENDED" : "DRIVER_REQUEUED";

  await auditModel.record({
    userId: adminId,
    action,
    entityType: "DRIVER",
    entityId: userId,
    metadata: { status },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const body =
    status === "ACTIVE"
      ? "You're approved to drive on Agbede. Go online to start receiving trips."
      : status === "SUSPENDED"
        ? "Your driver account has been suspended. Contact support for details."
        : "Your driver account is back in review.";

  await notify({
    userId,
    type: "SYSTEM",
    link: "driver.html",
    title: status === "ACTIVE" ? "Driver account approved" : "Driver account updated",
    body,
  });

  const fresh = await driverModel.profileByUser(userId);
  return { driver: fresh ? toApiDriver(fresh) : { userId, status } };
}

// ---------- Cargo ----------

function toApiCargo(q) {
  return {
    id: q.id,
    reference: q.reference,
    userId: q.user_id,
    userName: q.user_name ?? null,
    userPhone: q.user_phone ?? null,
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
    statusLabel: CARGO_STATUS_LABELS[q.status] ?? q.status,
    quotedAmountMinor: q.quoted_amount_minor === null ? null : Number(q.quoted_amount_minor),
    quotedAmountNgn: q.quoted_amount_minor === null ? null : formatNaira(q.quoted_amount_minor),
    adminNote: q.admin_note ?? null,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

export async function listCargo({ status = null } = {}) {
  const rows = await cargoModel.listAll({ status: status ?? null });
  return { items: rows.map(toApiCargo) };
}

export async function quoteCargo({ adminId, id, quotedAmountMinor = null, adminNote = null, status = null, ctx = {} }) {
  const existing = await cargoModel.findById(id);
  if (!existing) throw new ApiError(404, "Cargo request not found", "NOT_FOUND");

  if (quotedAmountMinor != null && (!Number.isInteger(quotedAmountMinor) || quotedAmountMinor <= 0)) {
    throw new ApiError(400, "Quote amount must be a positive amount", "VALIDATION");
  }

  const allowed = ["REQUESTED", "QUOTED", "ACCEPTED", "CLOSED", "CANCELLED"];
  if (status != null && !allowed.includes(status)) {
    throw new ApiError(400, "Invalid cargo status", "VALIDATION");
  }

  // Attaching a price on an unpriced request advances it to QUOTED automatically.
  let nextStatus = status ?? existing.status;
  if (quotedAmountMinor != null && nextStatus === "REQUESTED") nextStatus = "QUOTED";

  const updated = await cargoModel.setQuote({
    id,
    quotedAmountMinor: quotedAmountMinor ?? null,
    adminNote: adminNote ?? null,
    status: nextStatus,
  });

  await auditModel.record({
    userId: adminId,
    action: quotedAmountMinor != null ? "CARGO_QUOTED" : "CARGO_UPDATED",
    entityType: "CARGO_QUOTE",
    entityId: id,
    metadata: { reference: existing.reference, status: nextStatus, quotedAmountMinor },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  if (quotedAmountMinor != null && nextStatus !== existing.status) {
    await notify({
      userId: existing.user_id,
      type: "CARGO",
      link: `cargo.html?request=${id}`,
      title: `Your cargo quote is ready — ${formatNaira(quotedAmountMinor)}`,
      body: `${existing.pickup_address} → ${existing.dropoff_address}. Open the request to review and accept.`,
    });
  }

  return { quote: toApiCargo(updated) };
}

// ---------- Support ----------

function toApiTicket(t) {
  return {
    id: t.id,
    reference: t.reference,
    userId: t.user_id,
    userName: t.user_name ?? null,
    userPhone: t.user_phone ?? null,
    category: t.category,
    subject: t.subject,
    message: t.message,
    status: t.status,
    agentReply: t.agent_reply ?? null,
    repliedAt: t.replied_at ?? null,
    resolvedAt: t.resolved_at ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export async function listSupport({ status = null } = {}) {
  const rows = await supportModel.listAll({ status: status ?? null });
  return { items: rows.map(toApiTicket) };
}

export async function replySupport({ adminId, id, reply, status = "IN_PROGRESS", ctx = {} }) {
  const existing = await supportModel.findById(id);
  if (!existing) throw new ApiError(404, "Ticket not found", "NOT_FOUND");

  const allowed = ["OPEN", "IN_PROGRESS", "RESOLVED"];
  const nextStatus = allowed.includes(status) ? status : "IN_PROGRESS";

  const updated = await supportModel.reply({ id, agentReply: reply, status: nextStatus });

  await auditModel.record({
    userId: adminId,
    action: nextStatus === "RESOLVED" ? "SUPPORT_RESOLVED" : "SUPPORT_REPLIED",
    entityType: "SUPPORT_TICKET",
    entityId: id,
    metadata: { reference: existing.reference, status: nextStatus },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  await notify({
    userId: existing.user_id,
    type: "SUPPORT",
    link: "help.html",
    title: nextStatus === "RESOLVED" ? "Support resolved your ticket" : "Support replied to your ticket",
    body: reply.length > 160 ? `${reply.slice(0, 157)}…` : reply,
  });

  return { ticket: toApiTicket(updated) };
}

// ---------- Payments ----------

function toApiPayment(p) {
  return {
    id: p.id,
    reference: p.reference,
    provider: p.provider,
    providerRef: p.provider_ref ?? null,
    userId: p.user_id,
    userName: p.user_name ?? null,
    userPhone: p.user_phone ?? null,
    amountMinor: num(p.amount_minor),
    amountNgn: formatNaira(p.amount_minor),
    currency: p.currency,
    purpose: p.purpose,
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export async function listPayments({ status = null } = {}) {
  const rows = await paymentModel.listAll({ status: status ?? null });
  return { items: rows.map(toApiPayment) };
}

export async function reconcilePayment({ adminId, reference, ctx = {} }) {
  const result = await paymentService.reconcile({ reference });
  await auditModel.record({
    userId: adminId,
    action: "PAYMENT_RECONCILED",
    entityType: "PAYMENT",
    entityId: result.payment?.id ?? null,
    metadata: { reference, status: result.status ?? "SUCCESS" },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return result;
}
