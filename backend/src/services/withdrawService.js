// withdraw service — cash OUT to a linked bank account (simulated payout).
// Mirrors the funding service, inverted: debits the wallet, writes a
// WITHDRAWAL ledger row, replays on idempotency-key collision, audits every
// attempt. "Payouts" run through a mock provider (devOnly) until a real one.

import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as bankAccountModel from "../models/bankAccounts.js";
import * as transferModel from "../models/transferModel.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { formatNaira } from "../utils/money.js";
import { ApiError } from "../utils/errors.js";
import { assertWalletActive } from "./walletService.js";
import { assertWithdrawAllowed } from "./limitsService.js";
import { toApiTransaction } from "./transferService.js";

const MIN_WITHDRAW_MINOR = 100; // ₦1 minimum
const MAX_WITHDRAW_MINOR = 1_000_000_00; // ₦1,000,000 per cash-out
const MAX_ACCOUNTS = 5; // user's own linked bank accounts (kind = PAYOUT)
const MAX_AGENT_ACCOUNTS = 6; // cash-agent destinations (kind = AGENT)

const BANKS = ["Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA", "Kuda"];

// Cash-agent networks the (mock) payout provider can pay out to. These are real
// merchant networks; the badge helper gives each a brand colour on the client.
const AGENT_NETWORKS = ["Opay", "PalmPay", "Moniepoint", "Kuda"];

function toApiAccount(a) {
  return {
    id: a.id,
    bankName: a.bank_name,
    accountName: a.account_name,
    accountNumber: a.account_number,
    maskedNumber: `•• ${a.account_number.slice(-4)}`,
    kind: a.kind ?? "PAYOUT",
    createdAt: a.created_at,
  };
}

async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
}

// ---- Linked payout accounts -------------------------------------------------

export async function listAccounts(userId, kind = "PAYOUT") {
  const rows = await bankAccountModel.listForUser(userId, kind);
  return { accounts: rows.map(toApiAccount) };
}

export async function addAccount({ userId, bankName, accountName, accountNumber, kind = "PAYOUT" }) {
  const isAgent = kind === "AGENT";
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError(400, "Bank account numbers are exactly 10 digits", "VALIDATION");
  }
  const cap = isAgent ? MAX_AGENT_ACCOUNTS : MAX_ACCOUNTS;
  const count = await bankAccountModel.countForUser(userId, kind);
  if (count >= cap) {
    throw new ApiError(
      400,
      isAgent ? `You can use up to ${cap} cash agents` : `You can link up to ${cap} bank accounts`,
      "ACCOUNT_LIMIT"
    );
  }

  const existing = (await bankAccountModel.listForUser(userId, kind)).find(
    (a) => a.account_number === accountNumber && a.bank_name === bankName
  );
  if (existing) return { account: toApiAccount(existing), duplicate: true };

  let account;
  try {
    account = await bankAccountModel.create({ userId, bankName, accountName, accountNumber, kind });
  } catch (err) {
    // Lost a race to a concurrent add of the SAME (kind, number): return the
    // row that won instead of surfacing a 500.
    if (err.code === "23505") {
      const winner = (await bankAccountModel.listForUser(userId, kind)).find(
        (a) => a.account_number === accountNumber
      );
      if (winner) return { account: toApiAccount(winner), duplicate: true };
    }
    throw err;
  }

  await auditModel.record({
    userId,
    action: "BANK_ACCOUNT_ADDED",
    entityType: "BANK_ACCOUNT",
    entityId: account.id,
    metadata: { bankName, kind, maskedNumber: `•• ${accountNumber.slice(-4)}` }, // never the full number in logs
  });

  await notify({
    userId,
    type: "WITHDRAW",
    link: "withdraw.html",
    title: isAgent ? "Cash agent added" : "Bank account linked",
    body: isAgent
      ? `${bankName} agent added as a cash-out destination.`
      : `${bankName} · ${accountName} added as a cash-out destination.`,
  });

  return { account: toApiAccount(account), duplicate: false };
}

export async function removeAccount({ userId, accountId }) {
  const removed = await bankAccountModel.removeById(userId, accountId);
  if (!removed) throw new ApiError(404, "Bank account not found", "NOT_FOUND");

  await auditModel.record({
    userId,
    action: "BANK_ACCOUNT_REMOVED",
    entityType: "BANK_ACCOUNT",
    entityId: accountId,
  });

  return { removed: true };
}

// ---- Cash out -----------------------------------------------------------------

async function replay({ userId, account, transactionId }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(userId);
  return {
    withdrawal: detail ? toApiTransaction(detail) : null,
    account: account ? toApiAccount(account) : null,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: true,
    notice: "This cash-out was already processed.",
  };
}

export async function withdrawToBank({
  userId,
  accountId,
  amountMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_WITHDRAW_MINOR) {
    throw new ApiError(400, "Withdrawal amount must be at least ₦1", "VALIDATION");
  }
  if (amountMinor > MAX_WITHDRAW_MINOR) {
    throw new ApiError(400, "Withdrawal amount cannot exceed ₦1,000,000", "VALIDATION");
  }

  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const account = await bankAccountModel.findByOwnedId(userId, accountId);
  if (!account) throw new ApiError(404, "Bank account not found", "NOT_FOUND");

  // IDEMPOTENT REPLAY first: a retry must return the stored outcome and must NOT
  // be re-judged against the daily cash-out limit it already consumed.
  const existing = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "WITHDRAWAL");
  if (existing) return replay({ userId, account, transactionId: existing.id });

  // KYC tier cap: cash-out is locked until bio data is complete, and capped per day.
  await assertWithdrawAllowed(userId, wallet.id, amountMinor);

  const result = await transferModel.executeWithdrawal({
    walletId: wallet.id,
    bankAccountId: account.id,
    amountMinor,
    reference: generateReference("WDR"),
    idempotencyKey,
    narration: `Cash-out to ${account.bank_name} · ${formatNaira(amountMinor)}`,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "WITHDRAWAL");
    if (winner) return replay({ userId, account, transactionId: winner.id });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "WITHDRAWAL_FAILED",
      entityType: "TRANSACTION",
      entityId: null,
      metadata: { code: result.code, amountMinor, maskedNumber: `•• ${account.account_number.slice(-4)}` },
      ipAddress,
      userAgent,
    });
    const [status, message] =
      result.code === "INSUFFICIENT_FUNDS"
        ? [400, "Insufficient balance for this withdrawal"]
        : [403, "Wallet is frozen"];
    throw new ApiError(status, message, result.code);
  }

  const detail = await transferModel.findDetailedById(result.transaction.id);
  const fresh = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "WITHDRAWAL_SUCCESS",
    entityType: "TRANSACTION",
    entityId: detail.id,
    metadata: { reference: detail.reference, amountMinor, maskedNumber: `•• ${account.account_number.slice(-4)}` },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: result.transaction?.id }),
    title: `Cash-out of ${formatNaira(amountMinor)} to ${account.bank_name}`,
    body: `Sent to ${account.account_name} ·•• ${account.account_number.slice(-4)}. We'll keep you posted when it lands.`,
  });

  return {
    withdrawal: toApiTransaction(detail),
    account: toApiAccount(account),
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: false,
  };
}

// The set of banks the (mock) payout provider supports — surfaced for the UI.
export function supportedBanks() {
  return BANKS;
}

// Cash-agent networks the (mock) payout provider supports — surfaced for the UI.
export function supportedAgentNetworks() {
  return AGENT_NETWORKS;
}