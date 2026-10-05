// purchase service — business rules for airtime, electricity, data and cable.
// Every purchase is: verify caller + PIN -> call the (mock) provider -> debit the
// wallet atomically -> write an AIRTIME/BILLS ledger row -> audit. Idempotency
// keys make double-clicks single charges, exactly like transfers.

import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as purchaseModel from "../models/purchaseModel.js";
import * as transferModel from "../models/transferModel.js";
import * as auditModel from "../models/audit.js";
import * as airtimeProvider from "../providers/mockAirtimeProvider.js";
import * as billProvider from "../providers/mockBillProvider.js";
import * as bettingProvider from "../providers/mockBettingProvider.js";
import { verifyPin } from "../utils/crypto.js";
import { sha256 } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";
import { toApiTransaction } from "./transferService.js";

const FAILURE_STATUS = {
  WALLET_NOT_FOUND: [404, "Wallet not found"],
  WALLET_FROZEN: [403, "Wallet is frozen", "WALLET_FROZEN"],
  INSUFFICIENT_FUNDS: [400, "Insufficient balance to complete this purchase"],
  PLAN_NOT_FOUND: [400, "Invalid plan selected"],
  PROVIDER_NOT_FOUND: [400, "Unknown provider selected"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [
    400,
    "Purchase rejected",
    code,
  ];
  return new ApiError(status, message, outCode);
}

async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
}

function purchaseResponse({ tx, balance, extra }) {
  return {
    transactionId: tx.id,
    reference: tx.reference,
    amountMinor: Number(tx.amount_minor),
    amountNgn: formatNaira(Number(tx.amount_minor)),
    ...extra,
    status: tx.status,
  };
}

// The whole purchase flow minus the provider call, shared by all biller types.
async function settle({
  userId,
  wallet,
  type,
  amountMinor,
  narration,
  idempotencyKey,
  ipAddress,
  userAgent,
  extra,
}) {
  const existing = await purchaseModel.findExistingByKey(wallet.id, idempotencyKey);
  if (existing) {
    return replay({ userId, wallet, transactionId: existing.id, extra });
  }

  const result = await purchaseModel.executePurchase({
    senderWalletId: wallet.id,
    amountMinor,
    reference: generateReference(type === "AIRTIME" ? "AIR" : type === "BETTING" ? "BET" : "BIL"),
    idempotencyKey,
    type,
    narration,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await purchaseModel.findExistingByKey(wallet.id, idempotencyKey);
    if (winner) return replay({ userId, wallet, transactionId: winner.id, extra });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: `${type}_PURCHASE_FAILED`,
      entityType: "TRANSACTION",
      entityId: null,
      metadata: { code: result.code, amountMinor },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const detail = await transferModel.findDetailedById(result.transaction.id);
  const fresh = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: `${type}_PURCHASE_SUCCESS`,
    entityType: "TRANSACTION",
    entityId: detail.id,
    metadata: { reference: detail.reference, amountMinor },
    ipAddress,
    userAgent,
  });

  return {
    purchase: purchaseResponse({ tx: detail, balance: fresh, extra }),
    transaction: toApiTransaction(detail),
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: false,
  };
}

async function replay({ userId, wallet, transactionId, extra }) {
  const detail = await transferModel.findDetailedById(transactionId);
  const fresh = await walletModel.findByUserId(userId);
  return {
    purchase: detail ? purchaseResponse({ tx: detail, balance: fresh, extra }) : null,
    transaction: detail ? toApiTransaction(detail) : null,
    balanceMinor: Number(fresh.balance_minor),
    balanceNgn: formatNaira(fresh.balance_minor),
    replayed: true,
    notice: "This purchase was already processed.",
  };
}

// ---- Airtime ----------------------------------------------------------------

export function listAirtimeProviders() {
  return { networks: airtimeProvider.listNetworks() };
}

export async function purchaseAirtime({
  userId,
  network,
  phone,
  amountMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const providerResult = await airtimeProvider.purchaseAirtime({ network, phone, amountMinor });
  const narration = `Airtime · ${network} · ${formatNaira(amountMinor)} to ${phone}`;

  return settle({
    userId,
    wallet,
    type: "AIRTIME",
    amountMinor,
    narration,
    idempotencyKey,
    ipAddress,
    userAgent,
    extra: {
      network,
      phone,
      provider: providerResult.reference,
      devOnly: providerResult.devOnly,
    },
  });
}

// ---- Electricity ------------------------------------------------------------

export function listElectricityProviders() {
  return { disCos: billProvider.listDisCos() };
}

export async function purchaseElectricity({
  userId,
  disCo,
  meterNo,
  meterType,
  amountMinor,
  phone,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  if (!billProvider.listDisCos().some((d) => d.disCo === disCo)) {
    throw apiErrorFor("PROVIDER_NOT_FOUND");
  }

  const providerResult = await billProvider.purchaseElectricity({ disCo, meterNo, meterType, amountMinor });
  const narration = `Electricity · ${disCo} · ${meterType.toLowerCase()} meter ${meterNo}`;

  return settle({
    userId,
    wallet,
    type: "BILLS",
    amountMinor,
    narration,
    idempotencyKey,
    ipAddress,
    userAgent,
    extra: {
      biller: "ELECTRICITY",
      disCo,
      meterNo,
      meterType,
      token: providerResult.token,
      provider: providerResult.reference,
      devOnly: providerResult.devOnly,
    },
  });
}

// ---- Mobile data --------------------------------------------------------------

export function listDataProviders() {
  return { networks: billProvider.listDataPlans() };
}

export async function purchaseData({
  userId,
  network,
  planId,
  phone,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const plan = billProvider.findDataPlan(network, planId);
  if (!plan) throw apiErrorFor("PLAN_NOT_FOUND");

  const providerResult = await billProvider.purchaseData({ network, planId, phone });
  const narration = `Data · ${network} · ${plan.label} to ${phone}`;

  return settle({
    userId,
    wallet,
    type: "BILLS",
    amountMinor: plan.amountMinor,
    narration,
    idempotencyKey,
    ipAddress,
    userAgent,
    extra: {
      biller: "DATA",
      network,
      plan: plan.label,
      phone,
      provider: providerResult.reference,
      devOnly: providerResult.devOnly,
    },
  });
}

// ---- Cable TV ----------------------------------------------------------------

export function listCableProviders() {
  return { providers: billProvider.listCablePackages() };
}

export async function lookupCableAccount({ provider, decoderNo }) {
  if (!billProvider.listCablePackages().some((p) => p.provider === provider)) {
    throw apiErrorFor("PROVIDER_NOT_FOUND");
  }
  return billProvider.lookupCableAccount({ provider, decoderNo });
}

export async function purchaseCableSubscription({
  userId,
  provider,
  decoderNo,
  planId,
  phone,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const plan = billProvider.findCablePackage(provider, planId);
  if (!plan) throw apiErrorFor("PLAN_NOT_FOUND");

  const providerResult = await billProvider.purchaseCable({ provider, decoderNo, planId });
  const narration = `Cable TV · ${provider} · ${plan.label}`;

  return settle({
    userId,
    wallet,
    type: "BILLS",
    amountMinor: plan.amountMinor,
    narration,
    idempotencyKey,
    ipAddress,
    userAgent,
    extra: {
      biller: "CABLE",
      provider,
      decoderNo,
      plan: plan.label,
      providerRef: providerResult.reference,
      devOnly: providerResult.devOnly,
    },
  });
}

// ---- Betting -----------------------------------------------------------------

export function listBettingPlatforms() {
  return { platforms: bettingProvider.listBettingPlatforms() };
}

export async function lookupBettingAccount({ platform, customerId }) {
  if (!bettingProvider.listBettingPlatforms().some((p) => p.platform === platform)) {
    throw apiErrorFor("PROVIDER_NOT_FOUND");
  }
  return bettingProvider.lookupBettingAccount({ platform, customerId });
}

export async function purchaseBetting({
  userId,
  platform,
  customerId,
  amountMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const provider = bettingProvider.listBettingPlatforms().find((p) => p.platform === platform);
  if (!provider) throw apiErrorFor("PROVIDER_NOT_FOUND");

  const providerResult = await bettingProvider.fundBettingAccount({ platform, customerId, amountMinor });
  const narration = `Betting · ${provider.label} · fund ${customerId}`;

  return settle({
    userId,
    wallet,
    type: "BETTING",
    amountMinor,
    narration,
    idempotencyKey,
    ipAddress,
    userAgent,
    extra: {
      platform,
      customerId,
      provider: providerResult.reference,
      devOnly: providerResult.devOnly,
    },
  });
}

// ---- Shared helper used by the ID-verification service later -----------------
export function identityNumberHash(number) {
  return sha256(number);
}