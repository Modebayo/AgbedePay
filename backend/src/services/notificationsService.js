// notifications service — the business rules for the in-app notice tray.
// Creating a notification NEVER raises: it is a side effect of money movement,
// so failures here must not fail the transfer that triggered it.

import * as notificationModel from "../models/notifications.js";
import { ApiError } from "../utils/errors.js";

export function toApiNotification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    read: Boolean(n.read_at),
    readAt: n.read_at ?? null,
    createdAt: n.created_at,
  };
}

export async function list({ userId, limit, unreadOnly }) {
  const rows = await notificationModel.listByUser({ userId, limit, unreadOnly });
  return {
    items: rows.map(toApiNotification),
    unread: await notificationModel.unreadCount(userId),
  };
}

export async function markOneRead({ userId, notificationId }) {
  const updated = await notificationModel.markRead(userId, notificationId);
  if (!updated) throw new ApiError(404, "Notification not found", "NOT_FOUND");
  return { unread: await notificationModel.unreadCount(userId) };
}

export async function markAllRead({ userId }) {
  await notificationModel.markAllRead(userId);
  return { unread: 0 };
}

// Fired at money events. Swallows errors by design (see header comment).
// `link` is an IN-APP page (see the CHECK on the column) so tapping a tray row
// lands the user exactly where the story continues; it is optional because
// some notices (e.g. a welcome line) have nowhere to go.
export async function notify({ userId, type = "TRANSACTION", title, body, link }) {
  try {
    await notificationModel.create({
      userId,
      type: type ?? "TRANSACTION",
      title,
      body,
      link: sanitiseLink(link),
    });
  } catch (_err) {
    // never let a tray write take down a financial transaction
  }
}

// Only relative in-app pages survive: a stored link is rendered into href and
// data-goto attributes on every page, so an absolute, protocol-relative or
// script URL would be a stored-XSS and open-redirect hole. Accepted shapes:
//   page.html | page.html?query=1 | page.html#anchor | page.html?q=1#anchor
const LINK_PATTERN = /^[a-zA-Z0-9_-]+\.html(\?[A-Za-z0-9_=&%.-]*)?(#[A-Za-z0-9_=&%.-]*)?$/;

export function sanitiseLink(link) {
  if (!link || typeof link !== "string") return null;
  const value = link.trim();
  if (!LINK_PATTERN.test(value)) return null;
  return value.slice(0, 200);
}

// One place that decides where a notice of this type belongs, so a new event
// type only has to be listed here.
export function linkForType(type, { reference, id, page } = {}) {
  const tx = (target) => (target ? `transaction.html?id=${encodeURIComponent(target)}` : "transactions.html");
  switch (type) {
    case "TRANSACTION":
      return tx(id || reference);
    case "SAVINGS":
      return page || "savings.html";
    case "WEALTH":
      return page || "wealth.html";
    case "KYC":
      return page || "profile.html#verify-form";
    case "PROMO":
      return page || "rewards.html";
    case "SECURITY":
      return page || "profile.html";
    case "DISPATCH":
      return page || (id ? `logistics.html?booking=${encodeURIComponent(id)}` : null);
    case "RIDE":
      return page || (id ? `ride.html?booking=${encodeURIComponent(id)}` : null);
    case "WITHDRAW":
      return tx(id || reference) || "transactions.html";
    case "SUPPORT":
      return page || "help.html";
    case "SYSTEM":
      return page || null;
    default:
      return page || null;
  }
}