// support service — Help & Support tickets.
// Rules: (1) one open ticket per category (the user continues it, not spams),
// (2) a per-day creation cap, (3) every ticket lands in the notification tray
// so the user can always find the thread again.

import * as ticketModel from "../models/supportTickets.js";
import * as auditModel from "../models/audit.js";
import { notify } from "./notificationsService.js";
import { ApiError } from "../utils/errors.js";
import { generateReference } from "../utils/reference.js";

const MAX_OPEN_PER_DAY = 5;

const CATEGORY_LABELS = {
  PAYMENT: "a payment",
  WITHDRAWAL: "a cash-out",
  KYC: "verification",
  DISPATCH: "a delivery",
  RIDE: "a ride",
  CARD: "your card",
  OTHER: "something else",
};

export async function createTicket({ userId, category, subject, message, ctx = {} }) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await ticketModel.countSince(userId, since);
  if (recent >= MAX_OPEN_PER_DAY) {
    throw new ApiError(
      429,
      `You've sent ${MAX_OPEN_PER_DAY} tickets in the last 24 hours. We'll reply to your open ones first.`,
      "TICKET_LIMIT"
    );
  }

  const existing = await ticketModel.findOpenByCategory(userId, category);
  if (existing) {
    throw new ApiError(
      409,
      `You already have an open ticket about ${CATEGORY_LABELS[category] ?? "this"} — ${existing.reference}. Our agent will reply there.`,
      "TICKET_EXISTS"
    );
  }

  const ticket = await ticketModel.create({
    userId,
    reference: generateReference("TKT"),
    category,
    subject,
    message,
  });

  await auditModel.record({
    userId,
    action: "SUPPORT_TICKET_CREATED",
    entityType: "SUPPORT_TICKET",
    entityId: ticket.id,
    metadata: { reference: ticket.reference, category },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  await notify({
    userId,
    type: "SUPPORT",
    link: "help.html",
    title: `Support ticket ${ticket.reference}`,
    body: `We got your message about ${CATEGORY_LABELS[category] ?? "your request"}. An agent replies within 24 hours.`,
  });

  return { ticket: toApiTicket(ticket) };
}

export async function listTickets(userId) {
  const rows = await ticketModel.listForUser(userId);
  return { tickets: rows.map(toApiTicket) };
}

function toApiTicket(row) {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    subject: row.subject,
    message: row.message,
    status: row.status,
    agentReply: row.agent_reply ?? null,
    repliedAt: row.replied_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
