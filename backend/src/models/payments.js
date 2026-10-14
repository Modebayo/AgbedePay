// payments model — hosted-checkout attempts and the webhook inbox.
//
// payment_transactions tracks one checkout from PENDING → SUCCESS/FAILED. The
// wallet credit that accompanies SUCCESS goes through the normal FUNDING path
// (transferModel.executeFunding) keyed by `pay:<reference>`, so a webhook and a
// client verify racing each other still credit the wallet exactly once.
//
// payment_events is the inbox: UNIQUE(provider, event_id) makes a replayed
// webhook a no-op.

import { query } from "../config/db.js";

const COLUMNS = `id, user_id, provider, reference, provider_ref, amount_minor,
                 currency, purpose, status, wallet_transaction_id, metadata,
                 created_at, updated_at`;

export async function create({ userId, provider, reference, amountMinor, purpose, metadata }) {
  const { rows } = await query(
    `INSERT INTO payment_transactions
       (user_id, provider, reference, amount_minor, purpose, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [userId, provider, reference, amountMinor, purpose ?? "WALLET_FUNDING", metadata ?? null]
  );
  return rows[0] ?? null;
}

export async function attachProvider({ id, providerRef, metadata }) {
  const { rows } = await query(
    `UPDATE payment_transactions
        SET provider_ref = COALESCE($2, provider_ref),
            metadata = COALESCE($3, metadata),
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, providerRef ?? null, metadata ?? null]
  );
  return rows[0] ?? null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM payment_transactions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findByReference(reference) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM payment_transactions WHERE reference = $1`,
    [reference]
  );
  return rows[0] ?? null;
}

export async function listForUser(userId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM payment_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// Claim a payment as SUCCESS exactly once. Returns the row on the transition
// PENDING → SUCCESS, or null if it was already settled (so callers can treat
// null as "someone else won the race").
export async function claimSuccess({ id, providerRef, walletTransactionId }) {
  const { rows } = await query(
    `UPDATE payment_transactions
        SET status = 'SUCCESS',
            provider_ref = COALESCE($2, provider_ref),
            wallet_transaction_id = COALESCE($3, wallet_transaction_id),
            updated_at = now()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING ${COLUMNS}`,
    [id, providerRef ?? null, walletTransactionId ?? null]
  );
  return rows[0] ?? null;
}

export async function markFailed({ id, providerRef }) {
  const { rows } = await query(
    `UPDATE payment_transactions
        SET status = 'FAILED',
            provider_ref = COALESCE($2, provider_ref),
            updated_at = now()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING ${COLUMNS}`,
    [id, providerRef ?? null]
  );
  return rows[0] ?? null;
}

// Record a webhook event. Returns the new row, or null when the (provider,
// event_id) pair already exists — the caller skips processing a replay.
export async function recordEvent({ provider, eventId, eventType, payload }) {
  const { rows } = await query(
    `INSERT INTO payment_events (provider, event_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [provider, eventId, eventType ?? null, payload ?? null]
  );
  return rows[0] ?? null;
}

export async function listPending(limit = 50) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM payment_transactions
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---------- Admin queue ----------

// Every checkout attempt with the payer's identity, for the admin console.
// PENDING attempts float up: they are the ones a reconcile can still rescue.
export async function listAll({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT p.id, p.user_id, p.provider, p.reference, p.provider_ref, p.amount_minor,
            p.currency, p.purpose, p.status, p.wallet_transaction_id, p.metadata,
            p.created_at, p.updated_at, u.full_name AS user_name, u.phone AS user_phone
       FROM payment_transactions p
       JOIN users u ON u.id = p.user_id
      WHERE ($1::text IS NULL OR p.status = $1)
      ORDER BY (p.status = 'PENDING') DESC, p.created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}
