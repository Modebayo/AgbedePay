// payment service — hosted-checkout wallet funding (Paystack first).
//
// Flow: client initiates → we create a PENDING payment row and hand back the
// gateway's checkout URL → the user pays → either the gateway redirects them
// back (client calls verify) or it calls our webhook. BOTH paths funnel into
// settle(), which credits the wallet through the normal FUNDING ledger path
// keyed by `pay:<reference>`, so the money moves exactly once no matter how
// many times a webhook is retried or how the two paths interleave.

import { env } from "../config/env.js";
import { paymentProvider } from "../providers/paymentProvider.js";
import * as paymentModel from "../models/payments.js";
import * as walletModel from "../models/wallets.js";
import * as transferModel from "../models/transferModel.js";
import * as userModel from "../models/users.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import { creditBonusForFirstFunding } from "./referralService.js";

const MIN_FUND_MINOR = 100; // ₦1
const MAX_FUND_MINOR = 100_000_000; // ₦1,000,000

function callbackUrl() {
  return `${env.appBaseUrl}/pages/fund.html`;
}

function toApiPayment(p) {
  return {
    id: p.id,
    provider: p.provider,
    reference: p.reference,
    providerRef: p.provider_ref ?? null,
    amountMinor: Number(p.amount_minor),
    amountNgn: formatNaira(p.amount_minor),
    currency: p.currency,
    purpose: p.purpose,
    status: p.status,
    walletTransactionId: p.wallet_transaction_id ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function contactEmail(user) {
  // Gateways require an email; fall back to a stable synthetic address built
  // from the phone so funding still works for accounts without one.
  return user.email || `${user.phone}@agbedepay.local`;
}

export async function initiate({ userId, amountMinor, ctx = {} }) {
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_FUND_MINOR) {
    throw new ApiError(400, "Top-up amount must be at least ₦1", "VALIDATION");
  }
  if (amountMinor > MAX_FUND_MINOR) {
    throw new ApiError(400, "Top-up amount cannot exceed ₦1,000,000", "VALIDATION");
  }

  const wallet = await assertWalletActive(userId);
  const user = await userModel.findByUserId(userId);
  if (!user) throw new ApiError(404, "User not found", "NOT_FOUND");

  const reference = generateReference("PAY");
  const payment = await paymentModel.create({
    userId,
    provider: paymentProvider.name,
    reference,
    amountMinor,
    purpose: "WALLET_FUNDING",
    metadata: { initiatedFrom: "web" },
  });

  let checkout;
  try {
    checkout = await paymentProvider.initialize({
      email: contactEmail(user),
      amountMinor,
      reference,
      callbackUrl: callbackUrl(),
      metadata: { userId, reference },
    });
  } catch (err) {
    await paymentModel.markFailed({ id: payment.id, providerRef: null });
    throw err;
  }

  await paymentModel.attachProvider({ id: payment.id, providerRef: checkout.providerRef });
  await auditModel.record({
    userId,
    action: "PAYMENT_INITIATED",
    entityType: "PAYMENT",
    entityId: payment.id,
    metadata: { reference, amountMinor, provider: paymentProvider.name },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    payment: toApiPayment({ ...payment, provider_ref: checkout.providerRef }),
    authorizationUrl: checkout.authorizationUrl,
    accessCode: checkout.accessCode,
    sandbox: Boolean(checkout.sandbox),
    provider: paymentProvider.name,
    balanceMinor: Number(wallet.balance_minor),
  };
}

// Credit the wallet for a confirmed payment, exactly once. onFunded runs only on
// the caller that actually wins the PENDING → SUCCESS transition.
async function settle({ payment, providerRef, amountMinor }) {
  const expected = Number(payment.amount_minor);
  if (amountMinor != null && amountMinor !== expected) {
    await paymentModel.markFailed({ id: payment.id, providerRef });
    throw new ApiError(409, "Paid amount did not match the request", "AMOUNT_MISMATCH");
  }

  const wallet = await walletModel.findByUserId(payment.user_id);
  if (!wallet) throw new ApiError(409, "Wallet not found", "WALLET_MISSING");

  // Idempotent funding: a fixed key derived from the payment reference means a
  // webhook + a verify can both run and still credit only once.
  const idempotencyKey = `pay:${payment.reference}`;
  const fund = await transferModel.executeFunding({
    walletId: wallet.id,
    amountMinor: expected,
    reference: generateReference("PAYF"),
    idempotencyKey,
    narration: `Card top-up · ${formatNaira(expected)} (${payment.provider})`,
  });

  let ledgerId = fund.ok ? fund.transaction.id : null;
  if (!ledgerId) {
    const existing = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "FUNDING");
    ledgerId = existing?.id ?? null;
  }
  if (!fund.ok && fund.code !== "IDEMPOTENCY_CONFLICT") {
    throw new ApiError(403, "Wallet is frozen", "WALLET_FROZEN");
  }

  const claimed = await paymentModel.claimSuccess({
    id: payment.id,
    providerRef,
    walletTransactionId: ledgerId,
  });

  // Only the transition winner does the side effects (audit, notify, referral).
  if (claimed) {
    await auditModel.record({
      userId: payment.user_id,
      action: "PAYMENT_SUCCESS",
      entityType: "PAYMENT",
      entityId: payment.id,
      metadata: { reference: payment.reference, amountMinor: expected, provider: payment.provider },
    });
    const fresh = await walletModel.findByUserId(payment.user_id);
    await notify({
      userId: payment.user_id,
      type: "TRANSACTION",
      link: linkForType("TRANSACTION", { id: ledgerId }),
      title: `Wallet topped up — ${formatNaira(expected)}`,
      body: `Paid via ${payment.provider}. New balance ${formatNaira(fresh.balance_minor)}.`,
    });
    await creditBonusForFirstFunding(payment.user_id);
  }

  // If we lost the race, re-read so the caller reports the settled row, not the
  // stale PENDING snapshot it started from.
  const settled = claimed ?? (await paymentModel.findById(payment.id)) ?? payment;
  const latest = await walletModel.findByUserId(payment.user_id);
  return {
    payment: toApiPayment(settled),
    balanceMinor: Number(latest.balance_minor),
    balanceNgn: formatNaira(latest.balance_minor),
    replayed: !claimed,
  };
}

// Apply a provider verification/webhook result to a stored payment.
async function applyResult(payment, result) {
  if (result.status === "SUCCESS") {
    return settle({ payment, providerRef: result.providerRef, amountMinor: result.amountMinor });
  }
  if (result.status === "FAILED") {
    const failed = await paymentModel.markFailed({ id: payment.id, providerRef: result.providerRef });
    return { payment: toApiPayment(failed ?? payment), status: "FAILED" };
  }
  return { payment: toApiPayment(payment), status: "PENDING" };
}

// Called by the client after returning from checkout.
export async function verify({ userId, reference, ctx = {} }) {
  const payment = await paymentModel.findByReference(reference);
  if (!payment || payment.user_id !== userId) {
    throw new ApiError(404, "Payment not found", "NOT_FOUND");
  }
  if (payment.status === "SUCCESS") {
    const wallet = await walletModel.findByUserId(userId);
    return {
      payment: toApiPayment(payment),
      status: "SUCCESS",
      balanceMinor: Number(wallet.balance_minor),
      balanceNgn: formatNaira(wallet.balance_minor),
      replayed: true,
    };
  }

  const result = await paymentProvider.verify({ reference });
  await auditModel.record({
    userId,
    action: "PAYMENT_VERIFIED",
    entityType: "PAYMENT",
    entityId: payment.id,
    metadata: { reference, status: result.status },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return applyResult(payment, result);
}

// Reconcile a PENDING payment (admin, or a scheduled sweep of stragglers).
export async function reconcile({ reference }) {
  const payment = await paymentModel.findByReference(reference);
  if (!payment) throw new ApiError(404, "Payment not found", "NOT_FOUND");
  if (payment.status === "SUCCESS") return { payment: toApiPayment(payment), status: "SUCCESS", replayed: true };
  const result = await paymentProvider.verify({ reference });
  return applyResult(payment, result);
}

export async function list(userId) {
  const rows = await paymentModel.listForUser(userId);
  return { items: rows.map(toApiPayment) };
}

export async function handleWebhook({ providerName, headers, rawBody, body }) {
  const provider = paymentProvider;
  if (providerName && providerName !== provider.name) {
    throw new ApiError(400, "Unknown payment provider", "UNKNOWN_PROVIDER");
  }
  const raw = rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
  if (!provider.verifyWebhook({ rawBody: raw, headers })) {
    throw new ApiError(401, "Invalid webhook signature", "INVALID_SIGNATURE");
  }

  const evt = provider.parseWebhook(body);
  // De-dupe FIRST: a duplicate delivery is acknowledged but not re-processed.
  const stored = await paymentModel.recordEvent({
    provider: provider.name,
    eventId: evt.eventId,
    eventType: evt.eventType,
    payload: body ?? null,
  });
  if (!stored) return { duplicate: true };

  if (evt.status === "SUCCESS" && evt.reference) {
    const payment = await paymentModel.findByReference(evt.reference);
    if (payment && payment.status !== "SUCCESS") {
      await applyResult(payment, {
        status: "SUCCESS",
        amountMinor: evt.amountMinor,
        providerRef: evt.providerRef,
      });
    }
  } else if (evt.status === "FAILED" && evt.reference) {
    const payment = await paymentModel.findByReference(evt.reference);
    if (payment && payment.status === "PENDING") {
      await paymentModel.markFailed({ id: payment.id, providerRef: evt.providerRef });
    }
  }

  return { processed: true };
}

export async function reconcilePending() {
  const pending = await paymentModel.listPending(50);
  const results = [];
  for (const p of pending) {
    try {
      const result = await paymentProvider.verify({ reference: p.reference });
      const applied = await applyResult(p, result);
      results.push({ reference: p.reference, status: applied.status ?? "SUCCESS" });
    } catch (err) {
      results.push({ reference: p.reference, error: err.code ?? err.message });
    }
  }
  return { checked: pending.length, results };
}
