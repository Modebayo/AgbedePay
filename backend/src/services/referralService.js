// referral service — business rules for the "refer a friend" programme.
// Each friend who signs up with your code and makes a first top-up unlocks the
// featured ₦500 bonus for BOTH accounts. Exactly-once is guaranteed by the
// referrals table: UNIQUE(referred_id) + a compare-and-set on status.

import * as referralModel from "../models/referralModel.js";
import * as walletModel from "../models/wallets.js";
import * as transferModel from "../models/transferModel.js";
import * as userModel from "../models/users.js";
import { notify } from "./notificationsService.js";
import { generateReference } from "../utils/reference.js";
import { formatNaira } from "../utils/money.js";

export const REFERRAL_BONUS_MINOR = 50000; // ₦500

// Credit one wallet for a referral, idempotently. The deterministic funding
// key (a function of the referral id) means a re-run can never credit twice.
async function creditWallet({ walletId, referralId, suffix, narration }) {
  const key = `RFLB-${referralId}-${suffix}`;
  const existing = await transferModel.findExistingByKey(walletId, key, "FUNDING");
  if (existing) return existing;
  const result = await transferModel.executeFunding({
    walletId,
    amountMinor: REFERRAL_BONUS_MINOR,
    reference: generateReference("RFL"),
    idempotencyKey: key,
    narration,
  });
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    return transferModel.findExistingByKey(walletId, key, "FUNDING");
  }
  return result.transaction;
}

// Called after a SUCCESSFUL funding: unlocks the first-funding bonus for the
// referred user and their referrer. Returns null when there was nothing to pay.
export async function creditBonusForFirstFunding(referredUserId) {
  const claim = await referralModel.claimPending(referredUserId);
  if (!claim) return null;

  const referredWallet = await walletModel.findByUserId(claim.referred_id);
  const referrerWallet = await walletModel.findByUserId(claim.referrer_id);
  const credited = [];

  if (referredWallet) {
    credited.push(
      await creditWallet({
        walletId: referredWallet.id,
        referralId: claim.id,
        suffix: "referee",
        narration: "Referral bonus · welcome to AgbedePay",
      })
    );
    await notify({
      userId: claim.referred_id,
      type: "TRANSACTION",
      link: "rewards.html",
      title: `Referral bonus received — ${formatNaira(REFERRAL_BONUS_MINOR)}`,
      body: "Welcome to AgbedePay! Your first top-up earned you this bonus.",
    });
  }

  if (referrerWallet) {
    credited.push(
      await creditWallet({
        walletId: referrerWallet.id,
        referralId: claim.id,
        suffix: "referrer",
        narration: "Referral bonus · you referred a friend",
      })
    );
    await notify({
      userId: claim.referrer_id,
      type: "TRANSACTION",
      link: "rewards.html",
      title: `You earned ${formatNaira(REFERRAL_BONUS_MINOR)} from a referral`,
      body: "Your friend made their first top-up. The bonus is in your wallet.",
    });
  }

  return { referralId: claim.id, referrerId: claim.referrer_id, referredId: claim.referred_id, credited };
}

export async function myReferralStats(userId) {
  const user = await userModel.findByUserId(userId);
  const stats = await referralModel.getStats(userId);
  return {
    code: user?.referral_code ?? null,
    link: user ? `https://agbedepay.com/register?ref=${user.referral_code}` : null,
    referred: stats.referred,
    credited: stats.credited,
    bonusMinor: REFERRAL_BONUS_MINOR,
    bonusNgn: formatNaira(REFERRAL_BONUS_MINOR),
  };
}