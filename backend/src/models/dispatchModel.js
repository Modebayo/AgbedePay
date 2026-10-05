// dispatch model — the escrow-style money movement behind Logistics & Dispatch.
//
// A booking HOLDS its fare: the wallet is debited once and a DISPATCH ledger
// row is created with status PENDING (the escrow). Nothing leaves the app
// until the job finishes (PENDING -> SUCCESS) or is cancelled (PENDING ->
// REVERSED, plus a fresh REVERSAL row that credits the wallet back).
//
// Same backbone as every money move: BEGIN…COMMIT, the wallet locked FOR
// UPDATE, and the (wallet, idempotency_key) index on DISPATCH rows so a
// double-clicked "Book a pickup" replays instead of charging twice. A FAILED
// attempt still claims its key (compare savings/transfer models).

import { pool } from "../config/db.js";
import { query } from "../config/db.js";
import { sha256 } from "../utils/crypto.js";

const BOOK_COLUMNS = `b.id, b.user_id, b.service_type, b.item_type, b.vehicle_type,
       b.pickup_address, b.pickup_contact, b.pickup_lat, b.pickup_lng,
       b.dropoff_address, b.dropoff_contact, b.dropoff_lat, b.dropoff_lng,
       b.distance_km, b.est_duration_min, b.fare_breakdown, b.amount_minor,
       b.status, b.rider_name, b.rider_phone, b.rider_vehicle, b.rider_plate,
       b.rider_rating, b.rider_trips, b.rating, b.rating_tags, b.issue_type,
       b.issue_note, b.transaction_id, b.created_at, b.updated_at,
       t.reference, t.status AS ledger_status`;

// ---------- Read-side ----------

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${BOOK_COLUMNS}
       FROM dispatch_bookings b
       JOIN transactions t ON t.id = b.transaction_id
      WHERE b.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findByWalletAndKey(walletId, idempotencyKey) {
  const { rows } = await query(
    `SELECT b.id, t.reference, t.status AS ledger_status, t.failure_reason
       FROM transactions t
       LEFT JOIN dispatch_bookings b ON b.transaction_id = t.id
      WHERE t.sender_wallet_id = $1 AND t.idempotency_key = $2 AND t.type = 'DISPATCH'
      LIMIT 1`,
    [walletId, idempotencyKey]
  );
  return rows[0] ?? null;
}

export async function listByUser(userId) {
  const { rows } = await query(
    `SELECT ${BOOK_COLUMNS}
       FROM dispatch_bookings b
       JOIN transactions t ON t.id = b.transaction_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows;
}

// ---------- Write-side ----------

// A FAILED attempt still claims its idempotency key (same contract as every
// other money move) so a replay returns the original "rejected" answer.
async function recordFailure(client, fields, code) {
  await client.query(
    `INSERT INTO transactions
       (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
        type, status, failure_reason)
     VALUES ($1, $2, $3, $4, 'NGN', 'DISPATCH', 'FAILED', $5)`,
    [fields.reference, fields.idempotencyKey, fields.walletId, fields.amountMinor, code]
  );
  await client.query("COMMIT");
  return { ok: false, code };
}

export async function executeBooking({
  userId,
  walletId,
  amountMinor,
  reference,
  idempotencyKey,
  booking,
  deliveryOtpHash,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const walletResult = await client.query(
      `SELECT id, status, balance_minor FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = walletResult.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      return recordFailure(client, { reference, idempotencyKey, walletId, amountMinor }, "WALLET_FROZEN");
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      return recordFailure(client, { reference, idempotencyKey, walletId, amountMinor }, "INSUFFICIENT_FUNDS");
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    const insertedBooking = await client.query(
      `INSERT INTO dispatch_bookings
         (user_id, service_type, item_type, vehicle_type,
          pickup_address, pickup_contact, pickup_lat, pickup_lng,
          dropoff_address, dropoff_contact, dropoff_lat, dropoff_lng,
          distance_km, est_duration_min, fare_breakdown, amount_minor,
          delivery_otp_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
[userId, booking.serviceType, booking.itemType, booking.vehicleType,
        booking.pickupAddress, booking.pickupContact, booking.pickupLat, booking.pickupLng,
        booking.dropoffAddress, booking.dropoffContact, booking.dropoffLat, booking.dropoffLng,
        booking.distanceKm, booking.estDurationMin, JSON.stringify(booking.fareBreakdown), amountMinor,
        deliveryOtpHash]
    );

    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
          type, status, narration)
       VALUES ($1, $2, $3, $4, 'NGN', 'DISPATCH', 'PENDING', $5)
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, booking.narration]
    );

    await client.query(
      `UPDATE dispatch_bookings SET transaction_id = $2, updated_at = now() WHERE id = $1`,
      [insertedBooking.rows[0].id, ledger.rows[0].id]
    );

    await client.query("COMMIT");
    return { ok: true, booking: insertedBooking.rows[0], ledger: ledger.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "uq_transactions_dispatch_idempotency") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    throw err;
  } finally {
    client.release();
  }
}

// Advance the booking one step. `patches` carries whatever the step adds
// (rider details at ASSIGN, …). Reaching DELIVERED releases the held fare
// (PENDING -> SUCCESS). The row is locked FOR UPDATE so the current-status
// check below is authoritative even under concurrency.
export async function advanceBooking({ id, fromStatus, nextStatus, otpCode, patches = {} }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT * FROM dispatch_bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const booking = current.rows[0];
    if (!booking || booking.status !== fromStatus) {
      await client.query("ROLLBACK");
      return { ok: false, code: "INVALID_STATE" };
    }

    if (nextStatus === "DELIVERED") {
      if (!otpCode || sha256(otpCode) !== booking.delivery_otp_hash) {
        await client.query("ROLLBACK");
        return { ok: false, code: "INVALID_OTP" };
      }
    }

    const sets = ["status = $1", "updated_at = now()"];
    const values = [nextStatus];
    let ph = 2;
    const patchCols = {
      riderName: "rider_name",
      riderPhone: "rider_phone",
      riderVehicle: "rider_vehicle",
      riderPlate: "rider_plate",
      riderRating: "rider_rating",
      riderTrips: "rider_trips",
    };
    for (const [key, col] of Object.entries(patchCols)) {
      if (patches[key] !== undefined) {
        sets.push(`${col} = $${ph}`);
        values.push(patches[key]);
        ph += 1;
      }
    }
    values.push(id);
    await client.query(
      `UPDATE dispatch_bookings SET ${sets.join(", ")} WHERE id = $${ph}`,
      values
    );

    if (nextStatus === "DELIVERED") {
      await client.query(
        `UPDATE transactions SET status = 'SUCCESS', completed_at = now()
          WHERE id = $1 AND status = 'PENDING'`,
        [booking.transaction_id]
      );
    }

    const refreshed = await client.query(
      `SELECT * FROM dispatch_bookings WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");
    return { ok: true, booking: refreshed.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Cancel an in-flight booking and refund the held fare: the original DISPATCH
// row is marked REVERSED (history is never rewritten) and a new REVERSAL
// SUCCESS row credits the wallet back.
export async function cancelBooking({ id, reversableStatuses, reversalReference }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT * FROM dispatch_bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const booking = current.rows[0];
    if (!booking || !reversableStatuses.includes(booking.status)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_CANCELLABLE" };
    }

    const ledgerResult = await client.query(
      `SELECT id, amount_minor, sender_wallet_id, status
         FROM transactions WHERE id = $1 FOR UPDATE`,
      [booking.transaction_id]
    );
    const ledger = ledgerResult.rows[0];
    if (!ledger || ledger.status !== "PENDING") {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_CANCELLABLE" };
    }

    const walletResult = await client.query(
      `SELECT id, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [ledger.sender_wallet_id]
    );
    const wallet = walletResult.rows[0];
    if (!wallet || wallet.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return { ok: false, code: "WALLET_FROZEN" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [ledger.amount_minor, wallet.id]
    );

    await client.query(
      `INSERT INTO transactions
         (reference, sender_wallet_id, receiver_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, NULL, $3, 'NGN', 'REVERSAL', 'SUCCESS', $4, now())`,
      [reversalReference, wallet.id, ledger.amount_minor, `Refund — package booking cancelled`]
    );

    await client.query(
      `UPDATE transactions SET status = 'REVERSED', completed_at = now() WHERE id = $1`,
      [ledger.id]
    );

    await client.query(
      `UPDATE dispatch_bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");
    return { ok: true, refundedMinor: Number(ledger.amount_minor), walletId: wallet.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function rateBooking(id, rating, tags) {
  const { rows } = await query(
    `UPDATE dispatch_bookings
        SET rating = $2, rating_tags = $3, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, rating, tags ?? null]
  );
  return rows[0] ?? null;
}

export async function reportIssue(id, issueType, note) {
  const { rows } = await query(
    `UPDATE dispatch_bookings
        SET issue_type = $2, issue_note = $3, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, issueType, note ?? null]
  );
  return rows[0] ?? null;
}