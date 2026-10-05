// purchase model — ACID wallet debit + an AIRTIME/BILLS ledger record.
// Mirrors the transfer model's guarantees: one atomic transaction, row locks,
// and an idempotency index (uq_transactions_purchase_idempotency) that turns a
// double-clicked purchase into a single charge.

import { pool } from "../config/db.js";
import { query } from "../config/db.js";

function isIdempotencyConflict(err) {
  return err.code === "23505" && err.constraint === "uq_transactions_purchase_idempotency";
}

async function recordFailed(client, fields, code) {
  await client.query(
    `INSERT INTO transactions
       (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
        type, status, narration, failure_reason)
     VALUES ($1, $2, $3, $4, 'NGN', $5, 'FAILED', $6, $7)`,
    [
      fields.reference,
      fields.idempotencyKey ?? null,
      fields.senderWalletId,
      fields.amountMinor,
      fields.type,
      fields.narration ?? null,
      code,
    ]
  );
  await client.query("COMMIT");
  return { ok: false, code };
}

export async function executePurchase({
  senderWalletId,
  amountMinor,
  reference,
  idempotencyKey,
  type, // 'AIRTIME' | 'BILLS' | 'BETTING'
  narration,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT id, balance_minor, status FROM wallets
        WHERE id = $1 FOR UPDATE`,
      [senderWalletId]
    );
    const wallet = lock.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return { ok: false, code: wallet ? "WALLET_FROZEN" : "WALLET_NOT_FOUND" };
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      await client.query("ROLLBACK");
      return { ok: false, code: "INSUFFICIENT_FUNDS" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, senderWalletId]
    );

    const inserted = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', $5, 'SUCCESS', $6, now())
       RETURNING *`,
      [reference, idempotencyKey ?? null, senderWalletId, amountMinor, type, narration]
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

export async function findExistingByKey(senderWalletId, idempotencyKey) {
  const { rows } = await query(
    `SELECT id FROM transactions
      WHERE sender_wallet_id = $1 AND idempotency_key = $2
        AND type IN ('AIRTIME', 'BILLS', 'BETTING')`,
    [senderWalletId, idempotencyKey]
  );
  return rows[0] ?? null;
}