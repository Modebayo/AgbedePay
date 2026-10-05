// savings model — savings goals and the ACID deposit that funds them.
//
// Why does a deposit live in ONE database transaction with a row lock?
// A deposit touches FOUR rows: the wallet (balance check + debit), the goal
// (progress +1), and two ledger records (savings_transactions + transactions).
// BEGIN…COMMIT makes it atomic — if any statement fails, ROLLBACK undoes the lot,
// so money can never vanish in a crash.
//
// The wallet row is locked FOR UPDATE: a concurrent transfer and this deposit
// both touch the same wallet, and the lock makes the second one wait until the
// first commits — then it sees the fresh balance. Negative balance is impossible.
//
// Idempotency: the same (wallet, key) can only claim one SAVINGS_DEPOSIT row
// (index uq_transactions_savings_idempotency). A replay is detected and the
// caller returns the ORIGINAL outcome — double-click ≠ double charge.

import { pool } from "../config/db.js";
import { query } from "../config/db.js";

// ---------- Read-side functions ----------

export async function createGoal({ userId, name, targetAmountMinor, targetDate }) {
  const { rows } = await query(
    `INSERT INTO savings_goals (user_id, name, target_amount_minor, target_date)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, name, targetAmountMinor, targetDate ?? null]
  );
  return rows[0];
}

export async function findAllGoalsForUser(userId) {
  const { rows } = await query(
    `SELECT g.*,
            (SELECT count(*) FROM savings_transactions st
              WHERE st.goal_id = g.id AND st.status = 'SUCCESS') AS deposit_count
       FROM savings_goals g
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function findGoalById(id) {
  const { rows } = await query(`SELECT * FROM savings_goals WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findGoalDeposits(goalId, { page, limit }) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT id, amount_minor, type, reference, status, created_at
       FROM savings_transactions
      WHERE goal_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [goalId, limit, offset]
  );
  const count = await query(
    `SELECT count(*)::int AS total FROM savings_transactions WHERE goal_id = $1`,
    [goalId]
  );
  return { rows, total: count.rows[0].total };
}

// Idempotency re-check: has this wallet already claimed this key on a savings
// movement (deposit OR withdrawal)? The type-scoped index is the referee.
// The goal is recovered by joining on the shared reference (the transactions
// ledger row and the savings_transactions row use the same reference).
export async function findByGoalAndKey(walletId, idempotencyKey, type = "SAVINGS_DEPOSIT") {
  const { rows } = await query(
    `SELECT st.goal_id, t.id
       FROM transactions t
       JOIN savings_transactions st ON st.reference = t.reference
      WHERE t.sender_wallet_id = $1 AND t.idempotency_key = $2 AND t.type = $3
      LIMIT 1`,
    [walletId, idempotencyKey, type]
  );
  return rows[0] ?? null;
}

// How many SUCCESS deposits built a goal (for its card — failures don't count).
export async function countSuccessfulDeposits(goalId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total FROM savings_transactions
      WHERE goal_id = $1 AND status = 'SUCCESS'`,
    [goalId]
  );
  return rows[0].total;
}

// Total saved toward a goal — SUCCESS deposits only (failures never count).
export async function amountSavedByGoal(goalId) {
  const { rows } = await query(
    `SELECT COALESCE(sum(amount_minor), 0)::bigint AS saved
       FROM savings_transactions
      WHERE goal_id = $1 AND status = 'SUCCESS'`,
    [goalId]
  );
  return Number(rows[0].saved);
}

// ---------- Write-side: the ACID deposit ----------

// A deposit/withdrawal's FAILED attempt still claims its idempotency key (same
// pattern as transfers), so a replayed request returns "already handled"
// instead of limbo. savingsType/ledgerType tell the two movements apart:
// DEPOSIT vs WITHDRAWAL on the goal ledger, SAVINGS_DEPOSIT vs
// SAVINGS_WITHDRAWAL on the wallet ledger.
async function recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code, savingsType = "DEPOSIT", ledgerType = "SAVINGS_DEPOSIT" }) {
  await client.query(
    `INSERT INTO savings_transactions (goal_id, user_id, amount_minor, type, reference, status)
     VALUES ($1, $2, $3, $4, $5, 'FAILED')`,
    [goalId, userId, amountMinor, savingsType, reference]
  );
  await client.query(
    `INSERT INTO transactions
       (reference, idempotency_key, sender_wallet_id, amount_minor, currency, type, status, failure_reason)
     VALUES ($1, $2, $3, $4, 'NGN', $5, 'FAILED', $6)`,
    [reference, idempotencyKey, walletId, amountMinor, ledgerType, code]
  );
  await client.query("COMMIT"); // the FAILED record survives
  return { ok: false, code };
}

export async function executeDeposit({
  userId,
  goalId,
  walletId,
  amountMinor,
  reference,
  idempotencyKey,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the wallet and the goal FOR UPDATE — these checks are the truth.
    const walletResult = await client.query(
      `SELECT id, balance_minor, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = walletResult.rows[0];

    const goalResult = await client.query(
      `SELECT id, user_id, name, status, target_amount_minor, current_amount_minor
         FROM savings_goals WHERE id = $1 FOR UPDATE`,
      [goalId]
    );
    const goal = goalResult.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "WALLET_FROZEN" });
    }
    if (!goal || goal.user_id !== userId) {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "GOAL_NOT_FOUND" });
    }
    if (goal.status !== "ACTIVE") {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "GOAL_NOT_ACTIVE" });
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "INSUFFICIENT_FUNDS" });
    }

    // Debit the wallet ONCE, atomically with the rest of the transaction.
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    // Progress += deposit. Cross the target? The goal is now ACHIEVED.
    const updatedGoal = await client.query(
      `UPDATE savings_goals
          SET current_amount_minor = current_amount_minor + $1,
              status = CASE WHEN current_amount_minor + $1 >= target_amount_minor
                            THEN 'ACHIEVED' ELSE 'ACTIVE' END,
              updated_at = now()
        WHERE id = $2
        RETURNING *`,
      [amountMinor, goalId]
    );

    const deposit = await client.query(
      `INSERT INTO savings_transactions (goal_id, user_id, amount_minor, type, reference, status)
       VALUES ($1, $2, $3, 'DEPOSIT', $4, 'SUCCESS')
       RETURNING *`,
      [goalId, userId, amountMinor, reference]
    );

    // The wallet-level ledger row — the goal is the "receiver" of record.
    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'SAVINGS_DEPOSIT', 'SUCCESS', $5, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, `Deposit into ${goal.name}`]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      goal: updatedGoal.rows[0],
      deposit: deposit.rows[0],
      ledger: ledger.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "uq_transactions_savings_idempotency") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    throw err;
  } finally {
    client.release();
  }
}

// The mirror image of executeDeposit: money comes OUT of the goal and back INTO
// the wallet. Same rules, the other direction — wallet locked as the receiver,
// goal locked as the source, and a "can't withdraw more than is in here" guard.
export async function executeWithdrawal({
  userId,
  goalId,
  walletId,
  amountMinor,
  reference,
  idempotencyKey,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the wallet (to be credited) and the goal (to be debited) FOR UPDATE.
    const walletResult = await client.query(
      `SELECT id, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = walletResult.rows[0];

    const goalResult = await client.query(
      `SELECT id, user_id, name, status, target_amount_minor, current_amount_minor
         FROM savings_goals WHERE id = $1 FOR UPDATE`,
      [goalId]
    );
    const goal = goalResult.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "WALLET_FROZEN", savingsType: "WITHDRAWAL", ledgerType: "SAVINGS_WITHDRAWAL" });
    }
    if (!goal || goal.user_id !== userId) {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "GOAL_NOT_FOUND", savingsType: "WITHDRAWAL", ledgerType: "SAVINGS_WITHDRAWAL" });
    }
    if (goal.status !== "ACTIVE") {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "GOAL_NOT_ACTIVE", savingsType: "WITHDRAWAL", ledgerType: "SAVINGS_WITHDRAWAL" });
    }
    if (Number(goal.current_amount_minor) < amountMinor) {
      return recordFailure(client, { userId, goalId, walletId, amountMinor, reference, idempotencyKey, code: "SAVINGS_INSUFFICIENT", savingsType: "WITHDRAWAL", ledgerType: "SAVINGS_WITHDRAWAL" });
    }

    // Credit the wallet ONCE, atomically with the rest of the transaction.
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    // Progress -= withdrawn. A goal that drops back below its target reopens
    // as ACTIVE (an ACHIEVED goal that stays at/above target stays reached).
    const updatedGoal = await client.query(
      `UPDATE savings_goals
          SET current_amount_minor = current_amount_minor - $1,
              status = CASE WHEN current_amount_minor - $1 >= target_amount_minor
                            THEN status ELSE 'ACTIVE' END,
              updated_at = now()
        WHERE id = $2
        RETURNING *`,
      [amountMinor, goalId]
    );

    const withdrawal = await client.query(
      `INSERT INTO savings_transactions (goal_id, user_id, amount_minor, type, reference, status)
       VALUES ($1, $2, $3, 'WITHDRAWAL', $4, 'SUCCESS')
       RETURNING *`,
      [goalId, userId, amountMinor, reference]
    );

    // The wallet-level ledger row — the goal is the "source" of record.
    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'SAVINGS_WITHDRAWAL', 'SUCCESS', $5, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, `Withdrawal from ${goal.name}`]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      goal: updatedGoal.rows[0],
      withdrawal: withdrawal.rows[0],
      ledger: ledger.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "uq_transactions_savings_withdrawal_idempotency") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    throw err;
  } finally {
    client.release();
  }
}