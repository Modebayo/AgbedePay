// fund service — money IN. Credits the wallet via a simulated top-up gateway and
// writes a FUNDING ledger row. Same rules as every other money move: the wallet
// must be active, amounts are integer kobo, and the idempotency key makes a
// double-clicked "Add money" replay the original credit instead of doubling it.
//
// devOnly: no real payment provider is dialed (no card, no transfer reference
// server). The funding is ledger-real — balances and history move for real — but
// the "gateway" is simulated until a provider is wired in.

import * as walletModel from "../models/wallets.js";
import * as transferModel from "../models/transferModel.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import { toApiTransaction } from "./transferService.js";
import { creditBonusForFirstFunding } from "./referralService.js";

const MIN_FUND_MINOR = 100; // ₦1 minimum
const MAX_FUND_MINOR = 100_000_000; // ₦1,000,000 per top-up

function fundingResponse(tx) {
  return {
    transactionId: tx.id,
    reference: tx.reference,
    narration: tx.narration,
    amountMinor: Number(tx.amount_minor),
    amountNgn: formatNaira(Number(tx.amount_minor)),
    status: tx.status,
    provider: "mock-gateway",
    devOnly: true,
  };
}

async function replay({ userId, wallet, transactionId }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(userId);
  return {
    funding: detail ? fundingResponse(detail) : null,
    transaction: detail ? toApiTransaction(detail) : null,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: true,
    notice: "This top-up was already processed.",
  };
}

export async function fundWallet({
  userId,
  amountMinor,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_FUND_MINOR) {
    throw new ApiError(400, "Top-up amount must be at least ₦1", "VALIDATION");
  }
  if (amountMinor > MAX_FUND_MINOR) {
    throw new ApiError(400, "Top-up amount cannot exceed ₦1,000,000", "VALIDATION");
  }

  const wallet = await assertWalletActive(userId);

  const existing = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "FUNDING");
  if (existing) {
    return replay({ userId, wallet, transactionId: existing.id });
  }

  const result = await transferModel.executeFunding({
    walletId: wallet.id,
    amountMinor,
    reference: generateReference("FND"),
    idempotencyKey,
    narration: `Wallet top-up · ${formatNaira(amountMinor)}`,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "FUNDING");
    if (winner) return replay({ userId, wallet, transactionId: winner.id });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "WALLET_FUNDING_FAILED",
      entityType: "TRANSACTION",
      entityId: null,
      metadata: { code: result.code, amountMinor },
      ipAddress,
      userAgent,
    });
    throw new ApiError(403, "Wallet is frozen", "WALLET_FROZEN");
  }

  const detail = await transferModel.findDetailedById(result.transaction.id);
  const fresh = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "WALLET_FUNDING_SUCCESS",
    entityType: "TRANSACTION",
    entityId: detail.id,
    metadata: { reference: detail.reference, amountMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: detail.id }),
    title: `Wallet topped up — ${formatNaira(amountMinor)}`,
    body: `Ref ${detail.reference}. New balance ${formatNaira(Number(fresh.balance_minor))}.`,
  });

  // Referral: a friend's FIRST top-up unlocks the ₦500 bonus for both sides.
  await creditBonusForFirstFunding(userId);

  return {
    funding: fundingResponse(detail),
    transaction: toApiTransaction(detail),
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: false,
  };
}