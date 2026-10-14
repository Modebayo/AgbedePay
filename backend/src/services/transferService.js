// transfer service — the business rules for moving money.
//
// What lives here and not in the model:
//   - "who may do this" checks (the caller's own wallet, their PIN, ownership)
//   - idempotency REPLAY (return the stored outcome instead of double-spending)
//   - mapping a business failure code into a clean HTTP error
// The model's executeTransfer() owns the actual ACID debit/credit + locking.
//
// Money stays in INTEGER kobo everywhere. We only FORMAT it (naira strings)
// at the edge, for display and receipts.

import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as transferModel from "../models/transferModel.js";
import * as bankAccountModel from "../models/bankAccounts.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import { assertSendAllowed } from "./limitsService.js";
import { BANKS, resolveAccountName } from "../providers/mockBankProvider.js";

const MIN_BANK_SEND_MINOR = 100; // ₦1
const MAX_BANK_SEND_MINOR = 10_000_000_00; // ₦10,000,000 per send-to-bank

// ---- Shared conversion: DB row -> clean API shape ----------------------------------

export function toApiTransaction(t) {
  const amount = Number(t.amount_minor);
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    status: t.status,
    amountMinor: amount,
    amountNgn: formatNaira(amount),
    currency: t.currency,
    narration: t.narration,
    failureReason: t.failure_reason,
    createdAt: t.created_at,
    completedAt: t.completed_at,
    sender: t.sender_wallet_id
      ? { walletId: t.sender_wallet_id, name: t.sender_name, phone: t.sender_phone }
      : null,
    receiver: t.receiver_wallet_id
      ? { walletId: t.receiver_wallet_id, name: t.receiver_name, phone: t.receiver_phone }
      : null,
    bank: t.bank_account_id
      ? {
          accountId: t.bank_account_id,
          bankName: t.bank_name,
          accountName: t.account_name,
          accountNumber: t.account_number,
        }
      : null,
  };
}

// Direction of a money movement from one wallet's point of view. The default is
// that the wallet was debited unless it is the receiver; FUNDING and
// SAVINGS_WITHDRAWAL credit the wallet even though their ledger row records the
// wallet in sender_wallet_id.
function txDirection(type, senderWalletId, walletId) {
  if (type === "FUNDING" || type === "SAVINGS_WITHDRAWAL") return "CREDIT";
  return senderWalletId === walletId ? "DEBIT" : "CREDIT";
}

// Business failure codes emitted by the model -> HTTP response.
const FAILURE_STATUS = {
  RECIPIENT_NOT_FOUND: [404, "Recipient wallet not found"],
  SENDER_WALLET_FROZEN: [403, "Sender wallet is frozen", "WALLET_FROZEN"],
  RECIPIENT_WALLET_FROZEN: [403, "Recipient wallet is frozen", "RECIPIENT_WALLET_FROZEN"],
  INSUFFICIENT_FUNDS: [400, "Insufficient balance to complete this transaction"],
  TRANSFER_NOT_REVERSIBLE: [409, "This transaction cannot be reversed"],
  PAYER_WALLET_FROZEN: [403, "Payer wallet is frozen", "WALLET_FROZEN"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [
    400,
    "Transaction rejected",
    code,
  ];
  return new ApiError(status, message, outCode);
}

// Re-authenticate the user's own PIN before any money moves. Money movement is
// sensitive: the session proves WHO you are, the PIN proves you really meant it.
async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) {
    throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
  }
}

// ---- Send money --------------------------------------------------------------------

export async function sendMoney({
  senderUserId,
  recipientPhone,
  recipientAccount,
  amountMinor,
  narration,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const sender = await assertWalletActive(senderUserId); // throws if missing/frozen
  await requireOwnPin(pin, senderUserId);

  // Exactly one recipient identifier: a phone number or an AgbedePay account number.
  const phone = typeof recipientPhone === "string" && recipientPhone.trim() !== "" ? recipientPhone.trim() : null;
  const account = typeof recipientAccount === "string" && recipientAccount.trim() !== "" ? recipientAccount.trim() : null;
  if ((phone && account) || (!phone && !account)) {
    throw new ApiError(400, "Provide either a recipient phone number or an AgbedePay account number", ErrorCodes.VALIDATION);
  }

  // IDEMPOTENT REPLAY: has this (sender wallet, key) already produced a result?
  // Then return the ORIGINAL outcome — the money was already moved (or failed).
  // This MUST run before the KYC/limit check: a retry of a transfer that already
  // succeeded must not be re-judged against the daily limit it just consumed.
  const existing = await transferModel.findExistingByKey(sender.id, idempotencyKey);
  if (existing) {
    return replayOutcome({ senderUserId, senderWalletId: sender.id, transactionId: existing.id, idempotencyKey, ipAddress, userAgent, amountMinor });
  }

  // KYC tier cap: per-transfer and daily send limit. Throws before any debit.
  await assertSendAllowed(senderUserId, sender.id, amountMinor);

  const recipientWallet = account
    ? await walletModel.findByOwnerAccountNumber(account)
    : await walletModel.findByOwnerPhone(phone);
  if (!recipientWallet) {
    throw new ApiError(
      404,
      account ? "No AgbedePay account found for that number" : "No wallet found for that phone number",
      "RECIPIENT_NOT_FOUND"
    );
  }
  if (recipientWallet.id === sender.id) {
    throw new ApiError(400, "You cannot send money to your own wallet", "SELF_TRANSFER");
  }

  // A single human-readable identifier for audit/notification text.
  const recipientRef = account ? `account ${account}` : phone;

  const result = await transferModel.executeTransfer({
    senderWalletId: sender.id,
    receiverWalletId: recipientWallet.id,
    amountMinor,
    reference: generateReference("TXN"),
    idempotencyKey,
    narration: narration ?? null,
  });

  // Lost a race: another request with this same key committed first. Fetch and
  // replay THAT result instead of retrying the transfer.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await transferModel.findExistingByKey(sender.id, idempotencyKey);
    if (winner) {
      return replayOutcome({ senderUserId, senderWalletId: sender.id, transactionId: winner.id, idempotencyKey, ipAddress, userAgent, amountMinor });
    }
  }

  if (!result.ok) {
    await auditModel.record({
      userId: senderUserId,
      action: "TRANSFER_FAILED",
      entityType: "TRANSACTION",
      entityId: null,
      metadata: { code: result.code, recipient: recipientRef, amountMinor }, // never secrets
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const detail = await transferModel.findDetailedById(result.transaction.id);
  const fresh = await walletModel.findByUserId(senderUserId);

  await auditModel.record({
    userId: senderUserId,
    action: "TRANSFER_SUCCESS",
    entityType: "TRANSACTION",
    entityId: detail.id,
    metadata: { reference: detail.reference, recipient: recipientRef, amountMinor }, // never secrets
    ipAddress,
    userAgent,
  });

  await notify({
    userId: senderUserId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: detail.id }),
    title: `Sent ${formatNaira(amountMinor)} to ${detail.receiver_name || recipientRef}`,
    body: `Ref ${detail.reference}. New balance ${formatNaira(Number(fresh.balance_minor))}.`,
  });
  const receiverUserId = await walletModel.findUserIdByWalletId(detail.receiver_wallet_id);
  await notify({
    userId: receiverUserId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: detail.id }),
    title: `You received ${formatNaira(amountMinor)}`,
    body: `From ${detail.sender_name || "an AgbedePay user"}. Ref ${detail.reference}.`,
  });

  return {
    transaction: toApiTransaction(detail),
    replayed: false,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
  };
}

// Share the STORED result of an already-processed (sender, key). Reads the fresh
// balance too, so the caller sees their real numbers.
async function replayOutcome({ senderUserId, senderWalletId, transactionId, idempotencyKey, ipAddress, userAgent, amountMinor }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(senderUserId);

  await auditModel.record({
    userId: senderUserId,
    action: "TRANSFER_REPLAYED",
    entityType: "TRANSACTION",
    entityId: detail?.id ?? null,
    metadata: { idempotencyKey, amountMinor }, // never secrets; NOT the whole key
    ipAddress,
    userAgent,
  });

  return {
    transaction: detail ? toApiTransaction(detail) : null,
    replayed: true,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
  };
}

// ---- Send money to a bank (OPay-style) ------------------------------------------

export function supportedBanks() {
  return BANKS;
}

// AgbedePay recipient name enquiry: resolve the account holder from either their
// 10-digit account number or their phone, so the sender SEES who they're paying
// before confirming. Returns only the display name — never the recipient's
// balance or any other detail — with the same "who am I sending to?" intent as
// the bank NUBAN lookup.
export async function verifyAgbedeAccount(userId, { accountNumber, phone }) {
  const hasAccount = typeof accountNumber === "string" && accountNumber.trim() !== "";
  const hasPhone = typeof phone === "string" && phone.trim() !== "";
  if (hasAccount === hasPhone) {
    throw new ApiError(400, "Provide either an account number or a phone number", ErrorCodes.VALIDATION);
  }

  const recipient = hasAccount
    ? await userModel.findByAccountNumber(accountNumber.trim())
    : await userModel.findByPhone(phone.trim());

  if (!recipient) {
    throw new ApiError(404, "No AgbedePay account found", "RECIPIENT_NOT_FOUND");
  }

  await auditModel.record({
    userId,
    action: "AGBEDE_ACCOUNT_RESOLVED",
    entityType: "USER",
    entityId: recipient.id,
    metadata: hasAccount ? { masked: `•• ${accountNumber.slice(-4)}` } : { via: "PHONE" },
  });

  // findByPhone intentionally omits account_number (pre-migration resilience),
  // so resolve it separately when the recipient arrived by phone.
  let resolvedAccount = recipient.account_number ?? null;
  if (!resolvedAccount) {
    try {
      resolvedAccount = await userModel.getAccountNumberById(recipient.id);
    } catch (_) {
      resolvedAccount = null; // column absent before migration 036 — stay usable
    }
  }

  return {
    accountName: recipient.full_name,
    accountNumber: resolvedAccount,
    phone: recipient.phone ?? null,
  };
}

// NUBAN name enquiry → the "who am I sending to?" preview. Runs server-side at
// send time too, so a tampered client can never invent the recipient name.
export async function verifyBankAccount(userId, { bankName, accountNumber }) {
  const accountName = resolveAccountName(bankName, accountNumber);
  await auditModel.record({
    userId,
    action: "BANK_ACCOUNT_RESOLVED",
    metadata: { bankName, maskedNumber: `•• ${accountNumber.slice(-4)}` }, // never the full number
  });
  return { bankName, accountNumber, accountName };
}

async function replayBankSend({ senderUserId, transactionId }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(senderUserId);
  // Rebuild the beneficiary straight from the STORED transaction, so a replay
  // does not depend on the current request's bank/account or any side effects.
  const account =
    detail && detail.bank_account_id
      ? {
          id: detail.bank_account_id,
          bankName: detail.bank_name,
          accountName: detail.account_name,
          accountNumber: detail.account_number,
        }
      : null;
  return {
    transfer: detail ? toApiTransaction(detail) : null,
    account,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: true,
    notice: "This transfer was already processed.",
  };
}

export async function sendToBankMoney({
  senderUserId,
  bankName,
  accountNumber,
  amountMinor,
  narration,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  if (!Number.isInteger(amountMinor) || amountMinor < MIN_BANK_SEND_MINOR) {
    throw new ApiError(400, "Transfer amount must be at least ₦1", "VALIDATION");
  }
  if (amountMinor > MAX_BANK_SEND_MINOR) {
    throw new ApiError(400, "Transfer amount cannot exceed ₦10,000,000", "VALIDATION");
  }

  const sender = await assertWalletActive(senderUserId);
  await requireOwnPin(pin, senderUserId);

  // IDEMPOTENT REPLAY first (see sendMoney): a retry must return the stored
  // outcome and must NOT be re-judged against the daily limit it already used,
  // nor re-run the name enquiry / beneficiary side effects.
  const existing = await transferModel.findExistingByKey(sender.id, idempotencyKey, "BANK");
  if (existing) return replayBankSend({ senderUserId, transactionId: existing.id });

  // KYC tier cap: bank sends count against the same send limit as P2P.
  await assertSendAllowed(senderUserId, sender.id, amountMinor);

  // Resolve the name FIRST (mock NUBAN enquiry) so invalid accounts fail before
  // any ledger work happens.
  const { accountName } = await verifyBankAccount(senderUserId, { bankName, accountNumber });

  // Remember this beneficiary for faster repeat sends (OPay's "saved payees").
  let account = await bankAccountModel.findBeneficiary(senderUserId, bankName, accountNumber);
  if (!account) {
    account = await bankAccountModel.create({
      userId: senderUserId,
      bankName,
      accountName,
      accountNumber,
      kind: "BENEFICIARY",
    });
  }

  const result = await transferModel.executeSendToBank({
    walletId: sender.id,
    bankAccountId: account.id,
    amountMinor,
    reference: generateReference("BNK"),
    idempotencyKey,
    narration: narration ?? `Bank transfer to ${bankName} · ${accountName}`,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await transferModel.findExistingByKey(sender.id, idempotencyKey, "BANK");
    if (winner) return replayBankSend({ senderUserId, transactionId: winner.id });
  }

  if (!result.ok) {
    await auditModel.record({
      userId: senderUserId,
      action: "BANK_TRANSFER_FAILED",
      entityType: "TRANSACTION",
      entityId: null,
      metadata: { code: result.code, amountMinor, maskedNumber: `•• ${accountNumber.slice(-4)}` },
      ipAddress,
      userAgent,
    });
    const [status, message] =
      result.code === "INSUFFICIENT_FUNDS"
        ? [400, "Insufficient balance for this transfer"]
        : [403, "Wallet is frozen"];
    throw new ApiError(status, message, result.code);
  }

  const detail = await transferModel.findDetailedById(result.transaction.id);
  const fresh = await walletModel.findByUserId(senderUserId);

  await auditModel.record({
    userId: senderUserId,
    action: "BANK_TRANSFER_SUCCESS",
    entityType: "TRANSACTION",
    entityId: detail.id,
    metadata: { reference: detail.reference, amountMinor, maskedNumber: `•• ${accountNumber.slice(-4)}` },
    ipAddress,
    userAgent,
  });

  await notify({
    userId: senderUserId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: detail.id }),
    title: `Sent ${formatNaira(amountMinor)} to ${accountName}`,
    body: `To ${bankName} ·•• ${accountNumber.slice(-4)}. Ref ${detail.reference}.`,
  });

  return {
    transfer: toApiTransaction(detail),
    account: { id: account.id, bankName: account.bank_name, accountName: account.account_name, accountNumber: account.account_number },
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: false,
  };
}

// ---- History, detail, receipt -------------------------------------------------------

const SORT_SQL = {
  newest: "t.created_at DESC",
  oldest: "t.created_at ASC",
  amount_hi: "t.amount_minor DESC",
  amount_lo: "t.amount_minor ASC",
};

export async function listTransactions({ userId, page, limit, status, type, sort, from, to }) {
  const wallet = await walletModel.findByUserId(userId);
  if (!wallet) throw new ApiError(404, "Wallet not found", ErrorCodes.NOT_FOUND);

  const { rows, total } = await transferModel.listForWallet({
    walletId: wallet.id,
    status,
    type,
    from,
    to,
    page,
    limit,
    orderBy: SORT_SQL[sort] ?? SORT_SQL.newest,
  });

  return { items: rows.map(toApiTransaction), page, limit, total };
}

// CSV statement export — the customer-facing "download my history" feature.
// Values are quoted with doubled inner quotes so any narration/bank name is safe
// in Excel, Sheets and Numbers. No balances are computed here — amounts come
// straight from the ledger, formatted by the same helper used everywhere else.
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function exportCsvStatement({ userId, status, type, from, to, sort }) {
  const wallet = await walletModel.findByUserId(userId);
  if (!wallet) throw new ApiError(404, "Wallet not found", ErrorCodes.NOT_FOUND);

  const rows = await transferModel.listAllForWallet({
    walletId: wallet.id,
    status,
    type,
    from,
    to,
    orderBy: SORT_SQL[sort] ?? SORT_SQL.newest,
  });

  const header = ["Date", "Reference", "Type", "Status", "Direction", "Amount", "Narration", "Sender", "Receiver", "Bank"];
  const lines = rows.map((t) => {
    const amount = Number(t.amount_minor);
    const direction = txDirection(t.type, t.sender_wallet_id, wallet.id);
    return [
      t.completed_at ?? t.created_at,
      t.reference,
      t.type,
      t.status,
      direction,
      formatNaira(amount),
      t.narration,
      t.sender_name,
      t.receiver_name,
      t.bank_account_id ? `${t.bank_name} · ${t.account_name} · ${t.account_number}` : "",
    ]
      .map(csvCell)
      .join(",");
  });

  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return {
    filename: `agbedepay-statement-${stamp}.csv`,
    csv: "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n"),
  };
}

// Ownership IS the security here: a user may only view transactions their own
// wallet is part of. There is no way to ask for "someone else's" transaction.
export async function getTransactionDetail({ userId, transactionId }) {
  const wallet = await walletModel.findByUserId(userId);
  if (!wallet) throw new ApiError(404, "Wallet not found", ErrorCodes.NOT_FOUND);

  const tx = await transferModel.findById(transactionId);
  if (!tx || (tx.sender_wallet_id !== wallet.id && tx.receiver_wallet_id !== wallet.id)) {
    throw new ApiError(404, "Transaction not found", ErrorCodes.NOT_FOUND);
  }

  const detail = await transferModel.findDetailedById(transactionId);
  return { transaction: toApiTransaction(detail) };
}

// A receipt is the customer-facing view of a completed money movement.
export async function getReceipt({ userId, transactionId }) {
  const { transaction } = await getTransactionDetail({ userId, transactionId });

  if (transaction.status !== "SUCCESS" && transaction.status !== "REVERSED") {
    throw new ApiError(409, "A receipt is only available for a completed transaction", "RECEIPT_UNAVAILABLE");
  }

  const wallet = await walletModel.findByUserId(userId);
  const direction = txDirection(
    transaction.type,
    transaction.sender?.walletId ?? null,
    wallet.id
  );

  return {
    receipt: {
      transactionId: transaction.id,
      reference: transaction.reference,
      type: transaction.type,
      status: transaction.status,
      direction,
      amountMinor: transaction.amountMinor,
      amountNgn: transaction.amountNgn,
      currency: transaction.currency,
      narration: transaction.narration,
      sender: transaction.sender,
      receiver: transaction.receiver,
      bank: transaction.bank,
      completedAt: transaction.completedAt,
    },
  };
}

// ---- Reversal ----------------------------------------------------------------------

export async function reverseTransfer({ userId, transactionId, pin, ipAddress, userAgent }) {
  await requireOwnPin(pin, userId);
  const wallet = await assertWalletActive(userId);

  const tx = await transferModel.findById(transactionId);
  if (!tx) throw new ApiError(404, "Transaction not found", ErrorCodes.NOT_FOUND);

  // Only the sender or the receiver of the original transfer may reverse it.
  if (tx.sender_wallet_id !== wallet.id && tx.receiver_wallet_id !== wallet.id) {
    throw new ApiError(403, "You do not have permission to reverse this transaction", ErrorCodes.FORBIDDEN);
  }

  const result = await transferModel.executeReversal({
    originalId: transactionId,
    reversalReference: generateReference("RVS"),
    narration: `Reversal of ${tx.reference}`,
  });

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "REVERSAL_FAILED",
      entityType: "TRANSACTION",
      entityId: transactionId,
      metadata: { code: result.code, amountMinor: Number(tx.amount_minor) },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const reversal = await transferModel.findDetailedById(result.reversal.id);

  await auditModel.record({
    userId,
    action: "REVERSAL_SUCCESS",
    entityType: "TRANSACTION",
    entityId: transactionId,
    metadata: { reversalId: result.reversal.id, amountMinor: Number(tx.amount_minor) },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "TRANSACTION",
    link: linkForType("TRANSACTION", { id: result.reversal?.id ?? transactionId }),
    title: `Transfer reversed — ${formatNaira(Number(tx.amount_minor))} returned`,
    body: `Ref ${tx.reference} was reversed. New balance ${formatNaira(Number((await walletModel.findByUserId(userId)).balance_minor))}.`,
  });

  return {
    reversal: toApiTransaction(reversal),
    original: result.original,
    notice: "The money was returned and the original transfer is now flagged REVERSED.",
  };
}