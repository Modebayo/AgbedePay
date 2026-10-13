// transfer model — THE money movement. No other code may change a balance.
//
// Why is all of this inside ONE database transaction with row locks?
// Sending money touches several rows (sender balance, receiver balance, ledger
// record). If the process crashed between the debit and the credit, the system
// would be corrupted. BEGIN…COMMIT makes the whole thing atomic:
// either every statement succeeds, or (ROLLBACK) none of them did.
//
// Row locking: two requests arriving at the same instant would both read the
// same balance before either writes. SELECT … FOR UPDATE makes the *second*
// transaction WAIT until the first commits — then it sees the fresh balance.
// Locks are taken in consistent id order so two opposite-direction transfers
// can't deadlock on each other.

import { pool } from "../config/db.js";
import { query } from "../config/db.js";

export async function findById(id) {
  const { rows } = await query(`SELECT * FROM transactions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// A single unique violation on our idempotency index → the same (sender, key)
// was already used; the caller should fetch and replay the stored outcome.
function isIdempotencyConflict(err) {
  return (
    err.code === "23505" &&
    (err.constraint === "uq_transactions_sender_idempotency" ||
      err.constraint === "uq_transactions_funding_idempotency" ||
      err.constraint === "uq_transactions_savings_idempotency" ||
      err.constraint === "uq_transactions_purchase_idempotency" ||
      err.constraint === "uq_transactions_withdrawal_idempotency" ||
      err.constraint === "uq_transactions_bank_idempotency")
  );
}

// Persist a FAILED attempt so the idempotency key stays "claimed": a replayed
// request returns the original failed outcome rather than hiding in limbo.
async function recordFailure(client, fields, code) {
  await client.query(
    `INSERT INTO transactions
       (reference, idempotency_key, sender_wallet_id, receiver_wallet_id,
        amount_minor, currency, type, status, narration, failure_reason)
     VALUES ($1, $2, $3, $4, $5, 'NGN', 'TRANSFER', 'FAILED', $6, $7)`,
    [
      fields.reference,
      fields.idempotencyKey,
      fields.senderWalletId,
      fields.receiverWalletId ?? null,
      fields.amountMinor,
      fields.narration ?? null,
      code,
    ]
  );
  await client.query("COMMIT"); // the FAILED record survives
  return { ok: false, code };
}

export async function executeTransfer({
  senderWalletId,
  receiverWalletId,
  amountMinor,
  reference,
  idempotencyKey,
  narration,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock BOTH wallets in one statement, ordered by id (deadlock-safe).
    const lock = await client.query(
      `SELECT id, balance_minor, status
         FROM wallets
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [[senderWalletId, receiverWalletId]]
    );
    const wallets = new Map(lock.rows.map((w) => [w.id, w]));
    const sender = wallets.get(senderWalletId);
    const receiver = wallets.get(receiverWalletId);

    // These checks run UNDER the locks — they are the truth. A cheaper check
    // may have run in the service, but only now can nobody change the values.
    if (!sender || !receiver) {
      return recordFailure(client, { reference, idempotencyKey, senderWalletId, receiverWalletId, amountMinor, narration }, "RECIPIENT_NOT_FOUND");
    }
    if (sender.status !== "ACTIVE") {
      return recordFailure(client, { reference, idempotencyKey, senderWalletId, receiverWalletId, amountMinor, narration }, "SENDER_WALLET_FROZEN");
    }
    if (receiver.status !== "ACTIVE") {
      return recordFailure(client, { reference, idempotencyKey, senderWalletId, receiverWalletId, amountMinor, narration }, "RECIPIENT_WALLET_FROZEN");
    }
    if (Number(sender.balance_minor) < amountMinor) {
      return recordFailure(client, { reference, idempotencyKey, senderWalletId, receiverWalletId, amountMinor, narration }, "INSUFFICIENT_FUNDS");
    }

    // Debit sender, credit receiver — atomically.
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, senderWalletId]
    );
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [amountMinor, receiverWalletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, receiver_wallet_id,
          amount_minor, currency, type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'NGN', 'TRANSFER', 'SUCCESS', $6, now())
       RETURNING *`,
      [reference, idempotencyKey, senderWalletId, receiverWalletId, amountMinor, narration]
    );

    await client.query("COMMIT");
    return { ok: true, transaction: inserted.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isIdempotencyConflict(err)) return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    throw err;
  } finally {
    client.release();
  }
}

// Reversal — money flows back exactly, as a NEW REVERSAL record (we never edit
// a SUCCESS row's history; the original is only flagged status='REVERSED').
export async function executeReversal({ originalId, reversalReference, narration }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the ORIGINAL row FOR UPDATE — the authoritative status re-check.
    // Two concurrent reversals would both pass the service check; only the
    // first one can win here because the second WILL WAIT and then see REVERSED.
    const origQuery = await client.query(
      `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
      [originalId]
    );
    const original = origQuery.rows[0];

    if (!original || original.type !== "TRANSFER" || original.status !== "SUCCESS"
        || !original.receiver_wallet_id || !original.sender_wallet_id) {
      await client.query("ROLLBACK");
      return { ok: false, code: "TRANSFER_NOT_REVERSIBLE" };
    }

    const payerWalletId = original.receiver_wallet_id; // pays the money back
    const payeeWalletId = original.sender_wallet_id;

    const lock = await client.query(
      `SELECT id, balance_minor, status FROM wallets
        WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[payerWalletId, payeeWalletId]]
    );
    const wallets = new Map(lock.rows.map((w) => [w.id, w]));
    const payer = wallets.get(payerWalletId);
    const payee = wallets.get(payeeWalletId);

    if (!payer || payer.status !== "ACTIVE") {
      await client.query(
        `INSERT INTO transactions (reference, sender_wallet_id, receiver_wallet_id, amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, 'NGN', 'REVERSAL', 'FAILED', 'PAYER_WALLET_FROZEN')`,
        [reversalReference, payerWalletId, payeeWalletId ?? null, original.amount_minor]
      );
      await client.query("COMMIT");
      return { ok: false, code: "PAYER_WALLET_FROZEN" };
    }
    if (!payee) {
      await client.query(
        `INSERT INTO transactions (reference, sender_wallet_id, receiver_wallet_id, amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, 'NGN', 'REVERSAL', 'FAILED', 'RECIPIENT_NOT_FOUND')`,
        [reversalReference, payerWalletId, payeeWalletId ?? null, original.amount_minor]
      );
      await client.query("COMMIT");
      return { ok: false, code: "RECIPIENT_NOT_FOUND" };
    }
    if (Number(payer.balance_minor) < Number(original.amount_minor)) {
      await client.query(
        `INSERT INTO transactions (reference, sender_wallet_id, receiver_wallet_id, amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, 'NGN', 'REVERSAL', 'FAILED', 'INSUFFICIENT_FUNDS')`,
        [reversalReference, payerWalletId, payeeWalletId, original.amount_minor]
      );
      await client.query("COMMIT");
      return { ok: false, code: "INSUFFICIENT_FUNDS" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [original.amount_minor, payerWalletId]
    );
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [original.amount_minor, payeeWalletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, sender_wallet_id, receiver_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'REVERSAL', 'SUCCESS', $5, now())
       RETURNING *`,
      [reversalReference, payerWalletId, payeeWalletId, original.amount_minor,
       narration ?? `Reversal of ${original.reference}`]
    );

    // The original is marked REVERSED — its history is never rewritten.
    await client.query(
      `UPDATE transactions SET status = 'REVERSED', completed_at = now() WHERE id = $1`,
      [originalId]
    );

    await client.query("COMMIT");
    return { ok: true, reversal: inserted.rows[0], original: { id: originalId, status: "REVERSED" } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Lookups used by the service ----------

export async function findExistingByKey(senderWalletId, idempotencyKey, type = "TRANSFER") {
  const { rows } = await query(
    `SELECT id FROM transactions
      WHERE sender_wallet_id = $1 AND idempotency_key = $2 AND type = $3`,
    [senderWalletId, idempotencyKey, type]
  );
  return rows[0] ?? null;
}

export async function findDetailedById(id) {
  const { rows } = await query(
    `SELECT t.id, t.reference, t.type, t.status, t.amount_minor, t.currency,
            t.narration, t.failure_reason, t.created_at, t.completed_at,
            t.sender_wallet_id,
            su.full_name AS sender_name, su.phone AS sender_phone,
            t.receiver_wallet_id,
            ru.full_name AS receiver_name, ru.phone AS receiver_phone,
            ba.id AS bank_account_id, ba.bank_name, ba.account_name, ba.account_number
       FROM transactions t
       LEFT JOIN wallets sw ON sw.id = t.sender_wallet_id
       LEFT JOIN users su ON su.id = sw.user_id
       LEFT JOIN wallets rw ON rw.id = t.receiver_wallet_id
       LEFT JOIN users ru ON ru.id = rw.user_id
       LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
      WHERE t.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// Money that left this wallet TODAY, per cap bucket. Reversed/failed rows do
// not count — the money came back, so it never consumed the daily limit.
export async function sumTodayDebitsByType(walletId) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE type = 'TRANSFER'), 0)::bigint AS send_minor,
        COALESCE(SUM(amount_minor) FILTER (WHERE type = 'BANK'), 0)::bigint      AS bank_minor,
        COALESCE(SUM(amount_minor) FILTER (WHERE type = 'WITHDRAWAL'), 0)::bigint AS withdraw_minor
       FROM transactions
      WHERE sender_wallet_id = $1
        AND status = 'SUCCESS'
        AND type IN ('TRANSFER', 'BANK', 'WITHDRAWAL')
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'`,
    [walletId]
  );
  return rows[0] ?? { send_minor: 0, bank_minor: 0, withdraw_minor: 0 };
}

export async function listForWallet({ walletId, status, type, from, to, page, limit, orderBy }) {
  const offset = (page - 1) * limit;
  const where = `(t.sender_wallet_id = $1 OR t.receiver_wallet_id = $1)
                 AND ($2::text IS NULL OR t.status = $2)
                 AND ($3::text IS NULL OR t.type = $3)
                 AND ($4::timestamptz IS NULL OR t.created_at >= $4)
                 AND ($5::timestamptz IS NULL OR t.created_at <= $5)`;

  const { rows } = await query(
    `SELECT t.id, t.reference, t.type, t.status, t.amount_minor, t.currency,
            t.narration, t.failure_reason, t.created_at, t.completed_at,
            t.sender_wallet_id,
            su.full_name AS sender_name, su.phone AS sender_phone,
            t.receiver_wallet_id,
            ru.full_name AS receiver_name, ru.phone AS receiver_phone,
            ba.id AS bank_account_id, ba.bank_name, ba.account_name, ba.account_number
       FROM transactions t
       LEFT JOIN wallets sw ON sw.id = t.sender_wallet_id
       LEFT JOIN users su ON su.id = sw.user_id
       LEFT JOIN wallets rw ON rw.id = t.receiver_wallet_id
       LEFT JOIN users ru ON ru.id = rw.user_id
       LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
      WHERE ${where}
      ORDER BY ${orderBy ?? "t.created_at DESC"}
      LIMIT $6 OFFSET $7`,
    [walletId, status, type, from, to, limit, offset]
  );

  const count = await query(
    `SELECT count(*)::int AS total FROM transactions t WHERE ${where}`,
    [walletId, status, type, from, to]
  );

  return { rows, total: count.rows[0].total };
}

// Unpaged variant for CSV export — everything matching the filters, hard-capped
// so a pathological data set can't blow out a request.
export async function listAllForWallet({ walletId, status, type, from, to, orderBy, limit = 5000 }) {
  const where = `(t.sender_wallet_id = $1 OR t.receiver_wallet_id = $1)
                 AND ($2::text IS NULL OR t.status = $2)
                 AND ($3::text IS NULL OR t.type = $3)
                 AND ($4::timestamptz IS NULL OR t.created_at >= $4)
                 AND ($5::timestamptz IS NULL OR t.created_at <= $5)`;

  const { rows } = await query(
    `SELECT t.id, t.reference, t.type, t.status, t.amount_minor, t.currency,
            t.narration, t.failure_reason, t.created_at, t.completed_at,
            t.sender_wallet_id,
            su.full_name AS sender_name, su.phone AS sender_phone,
            t.receiver_wallet_id,
            ru.full_name AS receiver_name, ru.phone AS receiver_phone,
            ba.id AS bank_account_id, ba.bank_name, ba.account_name, ba.account_number
       FROM transactions t
       LEFT JOIN wallets sw ON sw.id = t.sender_wallet_id
       LEFT JOIN users su ON su.id = sw.user_id
       LEFT JOIN wallets rw ON rw.id = t.receiver_wallet_id
       LEFT JOIN users ru ON ru.id = rw.user_id
       LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
      WHERE ${where}
      ORDER BY ${orderBy ?? "t.created_at DESC"}
      LIMIT $6`,
    [walletId, status, type, from, to, limit]
  );
  return rows;
}

// Funding — money IN. Credits the wallet once and writes a FUNDING ledger row,
// atomically, reusing the (sender_wallet_id, idempotency_key) index so a
// double-clicked "Add money" replays the original instead of crediting twice.
export async function executeFunding({
  walletId,
  amountMinor,
  reference,
  idempotencyKey,
  narration,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the wallet — this balance update is the truth.
    const lock = await client.query(
      `SELECT id, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = lock.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      await client.query(
        `INSERT INTO transactions
           (reference, idempotency_key, sender_wallet_id, amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, 'NGN', 'FUNDING', 'FAILED', $5)`,
        [reference, idempotencyKey, walletId, amountMinor, "WALLET_FROZEN"]
      );
      await client.query("COMMIT");
      return { ok: false, code: "WALLET_FROZEN" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency, type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'FUNDING', 'SUCCESS', $5, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, narration ?? null]
    );

    await client.query("COMMIT");
    return { ok: true, transaction: inserted.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isIdempotencyConflict(err)) return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    throw err;
  } finally {
    client.release();
  }
}

// Send money to a BENEFICIARY's bank account (not a self cash-out). Same shape
// as a withdrawal — atomic debit + a BANK ledger row — but the payer is sending
// to someone else, and the (wallet, key) uniqueness lives in the BANK index.
export async function executeSendToBank({
  walletId,
  bankAccountId,
  amountMinor,
  reference,
  idempotencyKey,
  narration,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT id, status, balance_minor FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = lock.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      await client.query(
        `INSERT INTO transactions
           (reference, idempotency_key, sender_wallet_id, bank_account_id,
            amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, $5, 'NGN', 'BANK', 'FAILED', $6)`,
        [reference, idempotencyKey, walletId, bankAccountId, amountMinor, "WALLET_FROZEN"]
      );
      await client.query("COMMIT");
      return { ok: false, code: "WALLET_FROZEN" };
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      await client.query(
        `INSERT INTO transactions
           (reference, idempotency_key, sender_wallet_id, bank_account_id,
            amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, $5, 'NGN', 'BANK', 'FAILED', $6)`,
        [reference, idempotencyKey, walletId, bankAccountId, amountMinor, "INSUFFICIENT_FUNDS"]
      );
      await client.query("COMMIT");
      return { ok: false, code: "INSUFFICIENT_FUNDS" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, bank_account_id,
          amount_minor, currency, type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'NGN', 'BANK', 'SUCCESS', $6, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, bankAccountId, amountMinor, narration ?? null]
    );

    await client.query("COMMIT");
    return { ok: true, transaction: inserted.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isIdempotencyConflict(err)) return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    throw err;
  } finally {
    client.release();
  }
}

// Withdrawal — money OUT to a linked bank account. Debits the wallet and writes
// a WITHDRAWAL ledger row atomically. The (sender_wallet_id, idempotency_key)
// index for type WITHDRAWAL turns a double-clicked cash-out into a replay.
export async function executeWithdrawal({
  walletId,
  bankAccountId,
  amountMinor,
  reference,
  idempotencyKey,
  narration,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT id, status, balance_minor FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = lock.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      await client.query(
        `INSERT INTO transactions
           (reference, idempotency_key, sender_wallet_id, bank_account_id,
            amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, $5, 'NGN', 'WITHDRAWAL', 'FAILED', $6)`,
        [reference, idempotencyKey, walletId, bankAccountId, amountMinor, "WALLET_FROZEN"]
      );
      await client.query("COMMIT");
      return { ok: false, code: "WALLET_FROZEN" };
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      await client.query(
        `INSERT INTO transactions
           (reference, idempotency_key, sender_wallet_id, bank_account_id,
            amount_minor, currency, type, status, failure_reason)
         VALUES ($1, $2, $3, $4, $5, 'NGN', 'WITHDRAWAL', 'FAILED', $6)`,
        [reference, idempotencyKey, walletId, bankAccountId, amountMinor, "INSUFFICIENT_FUNDS"]
      );
      await client.query("COMMIT");
      return { ok: false, code: "INSUFFICIENT_FUNDS" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, bank_account_id,
          amount_minor, currency, type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'NGN', 'WITHDRAWAL', 'SUCCESS', $6, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, bankAccountId, amountMinor, narration ?? null]
    );

    await client.query("COMMIT");
    return { ok: true, transaction: inserted.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isIdempotencyConflict(err)) return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    throw err;
  } finally {
    client.release();
  }
}