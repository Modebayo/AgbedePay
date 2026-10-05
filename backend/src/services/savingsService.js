// savings service — the business rules for goals and deposits.
//
// What lives here and not in the model:
//   - "who may do this" checks (ownership, the caller's PIN)
//   - idempotency REPLAY (return the stored outcome instead of charging twice)
//   - mapping a business failure code into a clean HTTP error
// The model's executeDeposit() owns the actual ACID debit + progress update.
//
// Money stays in INTEGER kobo everywhere. We only FORMAT it at the edge.

import * as savingsModel from "../models/savingsModel.js";
import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";

// ---- Shared helpers ---------------------------------------------------------

// Progress is an INTEGER percentage of current/target (whole kobo math only).
function progressOf(goal) {
  const target = Number(goal.target_amount_minor);
  const current = Number(goal.current_amount_minor);
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current * 100) / target));
}

function toApiGoal(g) {
  const current = Number(g.current_amount_minor);
  const target = Number(g.target_amount_minor);
  return {
    id: g.id,
    name: g.name,
    targetAmountMinor: target,
    targetAmountNgn: formatNaira(target),
    currentAmountMinor: current,
    currentAmountNgn: formatNaira(current),
    progressPercent: progressOf(g),
    remainingMinor: Math.max(0, target - current),
    remainingNgn: formatNaira(Math.max(0, target - current)),
    targetDate: g.target_date,
    status: g.status,
    depositCount: g.deposit_count ?? 0,
    createdAt: g.created_at,
  };
}

function toApiDeposit(d) {
  const amount = Number(d.amount_minor);
  return {
    id: d.id,
    amountMinor: amount,
    amountNgn: formatNaira(amount),
    type: d.type,
    reference: d.reference,
    status: d.status,
    createdAt: d.created_at,
  };
}

// Re-authenticate the user's own PIN before any money moves.
async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) {
    throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
  }
}

// Deposit failure codes from the model -> HTTP response.
const FAILURE_STATUS = {
  WALLET_FROZEN: [403, "Wallet is frozen", "WALLET_FROZEN"],
  GOAL_NOT_FOUND: [404, "Goal not found", "GOAL_NOT_FOUND"],
  GOAL_NOT_ACTIVE: [409, "This goal is no longer accepting deposits", "GOAL_NOT_ACTIVE"],
  INSUFFICIENT_FUNDS: [400, "Insufficient balance to make this deposit"],
  SAVINGS_INSUFFICIENT: [400, "You can't withdraw more than what's saved in this goal", "SAVINGS_INSUFFICIENT"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [
    400,
    "Deposit rejected",
    code,
  ];
  return new ApiError(status, message, outCode);
}

// ---- Goals ------------------------------------------------------------------

export async function createGoal({ userId, name, targetAmountMinor, targetDate, ipAddress, userAgent }) {
  const goal = await savingsModel.createGoal({ userId, name, targetAmountMinor, targetDate });

  await auditModel.record({
    userId,
    action: "SAVING_GOAL_CREATED",
    entityType: "SAVINGS_GOAL",
    entityId: goal.id,
    metadata: { name, targetAmountMinor }, // never secrets
    ipAddress,
    userAgent,
  });

  return { goal: toApiGoal({ ...goal, deposit_count: 0 }) };
}

export async function listGoals(userId) {
  const rows = await savingsModel.findAllGoalsForUser(userId);
  return { goals: rows.map(toApiGoal) };
}

// Ownership IS the security here: a goal is only visible to the person who
// created it. There is no way to ask for someone else's goal.
export async function getGoalDetail({ userId, goalId, page, limit }) {
  const goal = await savingsModel.findGoalById(goalId);
  if (!goal || goal.user_id !== userId) {
    throw new ApiError(404, "Goal not found", "GOAL_NOT_FOUND");
  }

  const deposits = await savingsModel.findGoalDeposits(goalId, { page, limit });
  return {
    goal: toApiGoal({ ...goal, deposit_count: deposits.total }),
    deposits: { items: deposits.rows.map(toApiDeposit), page, limit, total: deposits.total },
  };
}

// ---- Deposit ------------------------------------------------------------------

export async function depositToGoal({
  userId,
  goalId,
  amountMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId); // throws if missing/frozen
  await requireOwnPin(pin, userId);

  // Cheap pre-check for a goal we might not even own. The model RE-CHECKS this
  // under the row lock — only that check is authoritative.
  const ownerGoal = await savingsModel.findGoalById(goalId);
  if (!ownerGoal || ownerGoal.user_id !== userId) {
    throw new ApiError(404, "Goal not found", "GOAL_NOT_FOUND");
  }
  if (ownerGoal.status !== "ACTIVE") {
    throw new ApiError(409, "This goal is no longer accepting deposits", "GOAL_NOT_ACTIVE");
  }

  // IDEMPOTENT REPLAY: has this (wallet, key) already produced a result?
  const existing = await savingsModel.findByGoalAndKey(wallet.id, idempotencyKey);
  if (existing) {
    return replayDeposit({ userId, goalId: existing.goal_id, wallet, idempotencyKey, ipAddress, userAgent, amountMinor });
  }

  const result = await savingsModel.executeDeposit({
    userId,
    goalId,
    walletId: wallet.id,
    amountMinor,
    reference: generateReference("DEP"),
    idempotencyKey,
  });

  // Lost a race: another request with this key committed first → replay theirs.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await savingsModel.findByGoalAndKey(wallet.id, idempotencyKey);
    if (winner) {
      return replayDeposit({ userId, goalId: winner.goal_id, wallet, idempotencyKey, ipAddress, userAgent, amountMinor });
    }
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "SAVING_DEPOSIT_FAILED",
      entityType: "SAVINGS_GOAL",
      entityId: goalId,
      metadata: { code: result.code, amountMinor },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshGoal = await savingsModel.findGoalById(goalId);
  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "SAVING_DEPOSIT_SUCCESS",
    entityType: "SAVINGS_GOAL",
    entityId: goalId,
    metadata: { reference: result.ledger.reference, amountMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "SAVINGS",
    link: linkForType("SAVINGS"),
    title: `${formatNaira(amountMinor)} deposited into ${freshGoal.name}`,
    body: `Saved so far: ${formatNaira((await savingsModel.amountSavedByGoal(goalId)) / 100)}.`,
  });

  return {
    deposit: toApiDeposit(result.deposit),
    goal: toApiGoal({ ...freshGoal, deposit_count: await savingsModel.countSuccessfulDeposits(goalId) }),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: false,
  };
}

// ---- Withdrawal ------------------------------------------------------------------

export async function withdrawFromGoal({
  userId,
  goalId,
  amountMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId); // throws if missing/frozen
  await requireOwnPin(pin, userId);

  // Cheap pre-check for a goal we might not even own. The model RE-CHECKS this
  // under the row lock — only that check is authoritative.
  const ownerGoal = await savingsModel.findGoalById(goalId);
  if (!ownerGoal || ownerGoal.user_id !== userId) {
    throw new ApiError(404, "Goal not found", "GOAL_NOT_FOUND");
  }
  if (ownerGoal.status !== "ACTIVE") {
    throw new ApiError(409, "This goal is closed", "GOAL_NOT_ACTIVE");
  }

  // IDEMPOTENT REPLAY: has this (wallet, key) already produced a result?
  const existing = await savingsModel.findByGoalAndKey(wallet.id, idempotencyKey, "SAVINGS_WITHDRAWAL");
  if (existing) {
    return replayWithdrawal({ userId, goalId: existing.goal_id, wallet, idempotencyKey, ipAddress, userAgent, amountMinor });
  }

  const result = await savingsModel.executeWithdrawal({
    userId,
    goalId,
    walletId: wallet.id,
    amountMinor,
    reference: generateReference("WDL"),
    idempotencyKey,
  });

  // Lost a race: another request with this key committed first → replay theirs.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await savingsModel.findByGoalAndKey(wallet.id, idempotencyKey, "SAVINGS_WITHDRAWAL");
    if (winner) {
      return replayWithdrawal({ userId, goalId: winner.goal_id, wallet, idempotencyKey, ipAddress, userAgent, amountMinor });
    }
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "SAVING_WITHDRAWAL_FAILED",
      entityType: "SAVINGS_GOAL",
      entityId: goalId,
      metadata: { code: result.code, amountMinor },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshGoal = await savingsModel.findGoalById(goalId);
  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "SAVING_WITHDRAWAL_SUCCESS",
    entityType: "SAVINGS_GOAL",
    entityId: goalId,
    metadata: { reference: result.ledger.reference, amountMinor },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "SAVINGS",
    link: linkForType("SAVINGS"),
    title: `${formatNaira(amountMinor)} withdrawn from ${freshGoal.name}`,
    body: `Back in your wallet: ${formatNaira(freshWallet.balance_minor)}. Saved so far: ${formatNaira((await savingsModel.amountSavedByGoal(goalId)) / 100)}.`,
  });

  return {
    withdrawal: toApiDeposit(result.withdrawal),
    goal: toApiGoal({ ...freshGoal, deposit_count: await savingsModel.countSuccessfulDeposits(goalId) }),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: false,
  };
}

// Share the STORED outcome of an already-processed (wallet, key) withdrawal.
async function replayWithdrawal({ userId, goalId, wallet, idempotencyKey, ipAddress, userAgent, amountMinor }) {
  const goal = await savingsModel.findGoalById(goalId);
  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "SAVING_WITHDRAWAL_REPLAYED",
    entityType: "SAVINGS_GOAL",
    entityId: goalId,
    metadata: { idempotencyKey, amountMinor }, // never secrets; NOT the whole key
    ipAddress,
    userAgent,
  });

  return {
    withdrawal: null,
    goal: goal ? toApiGoal(goal) : null,
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: true,
    notice: "This withdrawal was already processed.",
  };
}

// Share the STORED outcome of an already-processed (wallet, key) deposit.
async function replayDeposit({ userId, goalId, wallet, idempotencyKey, ipAddress, userAgent, amountMinor }) {
  const goal = await savingsModel.findGoalById(goalId);
  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "SAVING_DEPOSIT_REPLAYED",
    entityType: "SAVINGS_GOAL",
    entityId: goalId,
    metadata: { idempotencyKey, amountMinor }, // never secrets; NOT the whole key
    ipAddress,
    userAgent,
  });

  return {
    deposit: null,
    goal: goal ? toApiGoal(goal) : null,
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: true,
    notice: "This deposit was already processed.",
  };
}