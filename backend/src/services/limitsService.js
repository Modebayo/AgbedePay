// limits service — KYC-gated transaction limits.
// One table, one rule: what a user may send/cash out is DERIVED from their
// stored verification level. Raising the tier (bio data -> NIN/BVN) raises the
// cap immediately, with no flags to flip by hand.

import * as userModel from "../models/users.js";
import * as transferModel from "../models/transferModel.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";

// Minor units (kobo) throughout. 1 naira = 100 kobo.
export const LIMITS = {
  NONE: {
    level: "NONE",
    tier: "Tier 0",
    summary: "Just getting started",
    sendPerTransactionMinor: 500_000, // ₦5,000
    sendDailyMinor: 500_000, // ₦5,000
    withdrawDailyMinor: 0,
    withdrawAllowed: false,
    nextLevel: "BASIC",
    nextLabel: "Complete your bio data",
  },
  BASIC: {
    level: "BASIC",
    tier: "Tier 1",
    summary: "Bio data complete",
    sendPerTransactionMinor: 5_000_000, // ₦50,000
    sendDailyMinor: 5_000_000, // ₦50,000
    withdrawDailyMinor: 5_000_000, // ₦50,000
    withdrawAllowed: true,
    nextLevel: "IDENTITY_VERIFIED",
    nextLabel: "Verify your NIN or BVN",
  },
  IDENTITY_VERIFIED: {
    level: "IDENTITY_VERIFIED",
    tier: "Tier 2",
    summary: "Identity verified",
    sendPerTransactionMinor: 50_000_000, // ₦500,000
    sendDailyMinor: 100_000_000, // ₦1,000,000
    withdrawDailyMinor: 100_000_000, // ₦1,000,000
    withdrawAllowed: true,
    nextLevel: null,
    nextLabel: "Highest tier reached",
  },
};

function shape(tier, used) {
  const usedSend = used?.sendMinor ?? 0;
  const usedWithdraw = used?.withdrawMinor ?? 0;
  return {
    ...tier,
    sendPerTransactionNgn: formatNaira(tier.sendPerTransactionMinor),
    sendDailyNgn: formatNaira(tier.sendDailyMinor),
    withdrawDailyNgn: formatNaira(tier.withdrawDailyMinor),
    usedToday: {
      sendMinor: usedSend,
      sendNgn: formatNaira(usedSend),
      sendRemainingMinor: Math.max(0, tier.sendDailyMinor - usedSend),
      sendRemainingNgn: formatNaira(Math.max(0, tier.sendDailyMinor - usedSend)),
      withdrawMinor: usedWithdraw,
      withdrawNgn: formatNaira(usedWithdraw),
      withdrawRemainingMinor: Math.max(0, tier.withdrawDailyMinor - usedWithdraw),
      withdrawRemainingNgn: formatNaira(Math.max(0, tier.withdrawDailyMinor - usedWithdraw)),
    },
    nextTier: tier.nextLevel ? LIMITS[tier.nextLevel] : null,
  };
}

export async function getVerificationLevel(userId) {
  const row = await userModel.findUserWithKyc(userId);
  const level = row?.verification_level ?? "NONE";
  return LIMITS[level] ? level : "NONE";
}

// Money actually moved out of the wallet today, split by the cap it counts against.
async function usageToday(walletId) {
  const row = await transferModel.sumTodayDebitsByType(walletId);
  // Number() on purpose: the driver hands bigint back as a string, and
  // "0" + "0" would silently concatenate into "00" instead of adding up.
  return {
    sendMinor: Number(row?.send_minor ?? 0) + Number(row?.bank_minor ?? 0),
    withdrawMinor: Number(row?.withdraw_minor ?? 0),
  };
}

export async function getLimits(userId, walletId) {
  const level = await getVerificationLevel(userId);
  const used = walletId ? await usageToday(walletId) : { sendMinor: 0, withdrawMinor: 0 };
  return { limits: shape(LIMITS[level], used) };
}

function limitError(message) {
  return new ApiError(403, message, "LIMIT_EXCEEDED");
}

// Guard for P2P sends and bank sends. Called BEFORE any money moves.
export async function assertSendAllowed(userId, walletId, amountMinor) {
  const level = await getVerificationLevel(userId);
  const tier = LIMITS[level];
  const used = await usageToday(walletId);

  if (amountMinor > tier.sendPerTransactionMinor) {
    throw limitError(
      `Your ${tier.tier} limit is ${formatNaira(tier.sendPerTransactionMinor)} per transfer. ` +
        `${tier.nextLevel ? `${tier.nextLabel} to raise it to ${formatNaira(LIMITS[tier.nextLevel].sendPerTransactionMinor)}.` : "Split the payment into smaller amounts."}`
    );
  }

  const alreadySent = used.sendMinor;
  if (alreadySent + amountMinor > tier.sendDailyMinor) {
    const left = Math.max(0, tier.sendDailyMinor - alreadySent);
    throw limitError(
      `You've used today's send limit. ${formatNaira(left)} left today, resets at midnight. ` +
        (tier.nextLevel ? `${tier.nextLabel} to raise your daily limit to ${formatNaira(LIMITS[tier.nextLevel].sendDailyMinor)}.` : "")
    );
  }
}

// Guard for cash-out to a bank account.
export async function assertWithdrawAllowed(userId, walletId, amountMinor) {
  const level = await getVerificationLevel(userId);
  const tier = LIMITS[level];
  const used = await usageToday(walletId);

  if (!tier.withdrawAllowed) {
    throw new ApiError(
      403,
      `Cash-out unlocks once your bio data is complete. ${tier.nextLabel}.`,
      "KYC_REQUIRED"
    );
  }
  if (amountMinor > tier.withdrawDailyMinor) {
    throw limitError(
      `Your ${tier.tier} cash-out limit is ${formatNaira(tier.withdrawDailyMinor)} per day. ` +
        (tier.nextLevel ? `${tier.nextLabel} to raise it to ${formatNaira(LIMITS[tier.nextLevel].withdrawDailyMinor)}.` : "Try a smaller amount.")
    );
  }
  const left = Math.max(0, tier.withdrawDailyMinor - used.withdrawMinor);
  if (used.withdrawMinor + amountMinor > tier.withdrawDailyMinor) {
    throw limitError(
      `You've used today's cash-out limit. ${formatNaira(left)} left today, resets at midnight.`
    );
  }
}