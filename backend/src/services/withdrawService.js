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
const MAX_ACCOUNTS = 5;

const BANKS = ["Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA", "Kuda"];

function toApiAccount(a) {
  return {
    id: a.id,
    bankName: a.bank_name,
    accountName: a.account_name,
    accountNumber: a.account_number,
    maskedNumber: `•• ${a.account_number.slice(-4)}`,
    createdAt: a.created_at,
  };
}

async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
}

// ---- Linked payout accounts -------------------------------------------------

export async function listAccounts(userId) {
  const rows = await bankAccountModel.listForUser(userId);
  return { accounts: rows.map(toApiAccount) };
}

export async function addAccount({ userId, bankName, accountName, accountNumber }) {
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError(400, "Bank account numbers are exactly 10 digits", "VALIDATION");
  }
  const count = await bankAccountModel.countForUser(userId);
  if (count >= MAX_ACCOUNTS) {
    throw new ApiError(400, `You can link up to ${MAX_ACCOUNTS} bank accounts`, "ACCOUNT_LIMIT");
  }

  const existing = (await bankAccountModel.listForUser(userId)).find(
    (a) => a.account_number === accountNumber && a.bank_name === bankName
  );
  if (existing) return { account: toApiAccount(existing), duplicate: true };

  const account = await bankAccountModel.create({ userId, bankName, accountName, accountNumber });

  await auditModel.record({
    userId,
    action: "BANK_ACCOUNT_ADDED",
    entityType: "BANK_ACCOUNT",
    entityId: account.id,
    metadata: { bankName, maskedNumber: `•• ${accountNumber.slice(-4)}` }, // never the full number in logs
  });

  await notify({
    userId,
    type: "WITHDRAW",
    link: "withdraw.html",
    title: "Bank account linked",
    body: `${bankName} · ${accountName} added as a cash-out destination.`,
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

  // KYC tier cap: cash-out is locked until bio data is complete, and capped per day.
  await assertWithdrawAllowed(userId, wallet.id, amountMinor);

  const account = await bankAccountModel.findByOwnedId(userId, accountId);
  if (!account) throw new ApiError(404, "Bank account not found", "NOT_FOUND");

  const existing = await transferModel.findExistingByKey(wallet.id, idempotencyKey, "WITHDRAWAL");
  if (existing) return replay({ userId, account, transactionId: existing.id });

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