// payment-request service — OPay-style "request money".
// A would-be receiver asks a phone number for payment; the payer later settles
// the request with a normal TRANSFER (PIN-confirmed, idempotent). Request
// records just coordinate the ask — money only ever moves through the ledger.

import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as transferModel from "../models/transferModel.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import { toApiTransaction } from "./transferService.js";
import { query } from "../config/db.js";

const MIN_REQUEST_MINOR = 100; // ₦1

function toApiRequest(r) {
  return {
    id: r.id,
    requesterId: r.requester_id,
    requesterName: r.requester_name ?? null,
    requesterPhone: r.requester_phone ?? null,
    payerPhone: r.payer_phone,
    amountMinor: Number(r.amount_minor),
    amountNgn: formatNaira(r.amount_minor),
    note: r.note ?? null,
    status: r.status,
    transactionId: r.transaction_id ?? null,
    createdAt: r.created_at,
    paidAt: r.paid_at ?? null,
  };
}

async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
}

function fetch(predicate, params = []) {
  return query(`SELECT
      r.id, r.payer_phone, r.amount_minor, r.note, r.status,
      r.transaction_id, r.created_at, r.paid_at,
      u.full_name AS requester_name, u.phone AS requester_phone, u.id AS requester_id
    FROM payment_requests r
    LEFT JOIN users u ON u.id = r.requester_id
    WHERE ${predicate}
    ORDER BY r.created_at DESC`, params);
}

export async function requestMoney({ requesterId, payerPhone, amountMinor, note, ipAddress, userAgent }) {
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_REQUEST_MINOR) {
    throw new ApiError(400, "Requested amount must be at least ₦1", "VALIDATION");
  }

  const requesterWallet = await walletModel.findByUserId(requesterId);
  const payerWallet = await walletModel.findByOwnerPhone(payerPhone);
  if (!payerWallet) {
    throw new ApiError(404, "No AgbedePay wallet found for that phone number", "RECIPIENT_NOT_FOUND");
  }
  if (payerWallet.id === requesterWallet.id) {
    throw new ApiError(400, "You cannot request money from yourself", "SELF_REQUEST");
  }

  let request;
  try {
    const { rows } = await query(
      `INSERT INTO payment_requests (requester_id, payer_phone, amount_minor, note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [requesterId, payerPhone, amountMinor, note?.trim() || null]
    );
    request = rows[0];
  } catch (err) {
    if (err.code === "23505" && err.constraint === "uq_payment_requests_pending") {
      throw new ApiError(409, "You already have an open request to this person", "REQUEST_ALREADY_OPEN");
    }
    throw err;
  }

  await auditModel.record({
    userId: requesterId,
    action: "REQUEST_MONEY_CREATED",
    entityType: "PAYMENT_REQUEST",
    entityId: request.id,
    metadata: { payerPhone, amountMinor },
    ipAddress,
    userAgent,
  });

  const payerUserId = await walletModel.findUserIdByWalletId(payerWallet.id);
  const requester = await userModel.findByUserId(requesterId);
  await notify({
    userId: payerUserId,
    type: "TRANSACTION",
    link: "requests.html",
    title: `${requester?.full_name ?? "Someone"} requested ${formatNaira(amountMinor)}`,
    body: `Open Requests to pay it back in one tap.`,
  });

  const detail = (await fetch("r.id = $1", [request.id])).rows[0];
  return { request: toApiRequest(detail) };
}

export async function listRequests({ userId, myPhone }) {
  const outgoing = (await fetch("r.requester_id = $1", [userId])).rows;
  const incoming = (await fetch("r.payer_phone = $1 AND r.status = 'PENDING'", [myPhone])).rows;
  return {
    outgoing: outgoing.map(toApiRequest),
    incoming: incoming.map(toApiRequest),
  };
}

export async function cancelRequest({ userId, requestId, ipAddress, userAgent }) {
  const { rows } = await query(
    `UPDATE payment_requests SET status = 'CANCELLED'
      WHERE id = $1 AND requester_id = $2 AND status = 'PENDING'
      RETURNING *`,
    [requestId, userId]
  );
  if (!rows[0]) {
    const exists = await query(`SELECT id, requester_id, status FROM payment_requests WHERE id = $1`, [requestId]);
    const row = exists.rows[0];
    if (!row) throw new ApiError(404, "Payment request not found", ErrorCodes.NOT_FOUND);
    if (row.requester_id !== userId) throw new ApiError(403, "Only the requester can cancel this request", ErrorCodes.FORBIDDEN);
    throw new ApiError(409, "This request is no longer pending", "REQUEST_NOT_PENDING");
  }

  await auditModel.record({
    userId,
    action: "REQUEST_MONEY_CANCELLED",
    entityType: "PAYMENT_REQUEST",
    entityId: requestId,
    ipAddress,
    userAgent,
  });

  return { request: toApiRequest(rows[0]) };
}

// Settle a PENDING request addressed to MY phone number: a real TRANSFER from
// my wallet to the requester's, then the request row is marked PAID. The
// transfer's idempotency key makes a double-tap settle exactly once — a replay
// returns the ORIGINAL outcome even after the request has already been PAID.
export async function payRequest({
  userId,
  myPhone,
  requestId,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const payer = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  // Idempotency FIRST — check before the PENDING lookup. If this (wallet, key)
  // already settled a request that was addressed to my phone, that IS the
  // replay: return it as-is instead of erroring "request no longer pending".
  const existing = await transferModel.findExistingByKey(payer.id, idempotencyKey, "TRANSFER");
  if (existing) {
    const settled = await query(
      `SELECT r.id, r.payer_phone, r.amount_minor, r.note, r.status,
              r.transaction_id, r.created_at, r.paid_at,
              u.full_name AS requester_name, u.phone AS requester_phone, u.id AS requester_id
         FROM payment_requests r
         LEFT JOIN users u ON u.id = r.requester_id
        WHERE r.transaction_id = $1 AND r.payer_phone = $2 AND r.status = 'PAID'`,
      [existing.id, myPhone]
    );
    if (settled.rows[0]) {
      return payOutcome({
        userId,
        request: settled.rows[0],
        transactionId: existing.id,
        requesterId: settled.rows[0].requester_id,
        replayed: true,
        ipAddress,
        userAgent,
      });
    }
    // Key was used for some OTHER transfer — the ledger will reject the reuse.
  }

  const { rows } = await query(
    `SELECT r.*, u.full_name AS requester_name, u.phone AS requester_phone, u.id AS requester_id
       FROM payment_requests r
       LEFT JOIN users u ON u.id = r.requester_id
      WHERE r.id = $1 AND r.status = 'PENDING'`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new ApiError(404, "No pending payment request found", "REQUEST_NOT_FOUND");
  if (request.payer_phone !== myPhone) {
    throw new ApiError(403, "This request is addressed to another phone number", ErrorCodes.FORBIDDEN);
  }

  const requesterWallet = await walletModel.findByOwnerPhone(request.requester_phone);
  if (!requesterWallet) {
    throw new ApiError(404, "The requester's wallet is no longer available", "RECIPIENT_NOT_FOUND");
  }

  const result = await transferModel.executeTransfer({
    senderWalletId: payer.id,
    receiverWalletId: requesterWallet.id,
    amountMinor: Number(request.amount_minor),
    reference: `REQ-${requestId.slice(0, 8).toUpperCase()}`,
    idempotencyKey,
    narration: request.note ?? `Payment for request · ${request.requester_name ?? request.requester_phone}`,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await transferModel.findExistingByKey(payer.id, idempotencyKey, "TRANSFER");
    if (winner) {
      await settle(requestId, winner.id);
      return payOutcome({ userId, request, transactionId: winner.id, requesterId: request.requester_id, replayed: true, ipAddress, userAgent });
    }
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "REQUEST_PAYMENT_FAILED",
      entityType: "PAYMENT_REQUEST",
      entityId: requestId,
      metadata: { code: result.code, amountMinor: Number(request.amount_minor) },
      ipAddress,
      userAgent,
    });
    const [status, message] =
      result.code === "INSUFFICIENT_FUNDS"
        ? [400, "Insufficient balance to pay this request"]
        : [403, "Wallet is frozen"];
    throw new ApiError(status, message, result.code);
  }

  await settle(requestId, result.transaction.id);
  return payOutcome({ userId, request, transactionId: result.transaction.id, requesterId: request.requester_id, replayed: false, ipAddress, userAgent });
}

async function settle(requestId, transactionId) {
  await query(
    `UPDATE payment_requests
        SET status = 'PAID', transaction_id = $2, paid_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [requestId, transactionId]
  );
}

async function payOutcome({ userId, request, transactionId, requesterId, replayed, ipAddress, userAgent }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "REQUEST_PAYMENT_SUCCESS",
    entityType: "PAYMENT_REQUEST",
    entityId: request.id,
    metadata: { transactionId, replayed, amountMinor: Number(request.amount_minor) },
    ipAddress,
    userAgent,
  });

  await notify({
    userId: requesterId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: transactionId }),
    title: `You received ${formatNaira(request.amount_minor)}`,
    body: `Your payment request was settled. Ref ${detail?.reference ?? transactionId}.`,
  });

  return {
    request: toApiRequest({ ...request, status: "PAID", transaction_id: transactionId, paid_at: new Date().toISOString() }),
    transfer: detail ? toApiTransaction(detail) : null,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed,
  };
}