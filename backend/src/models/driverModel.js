// driverModel — all SQL for the Agbede Driver vertical.
//
// Three responsibilities:
//   1) driver profile + availability (driver_profiles)
//   2) offers + the ATOMIC accept that guarantees one driver per booking
//   3) settlement: completing a trip releases the customer's escrow and pays
//      the driver their net (gross − commission) into their wallet, exactly
//      once, in a single transaction.
//
// Accept and settlement are deliberately here (not spread across rideModel /
// dispatchModel) so the cross-table money move has one owner.

import { pool, query } from "../config/db.js";
import { sha256 } from "../utils/crypto.js";

// ---------- Profile / availability ----------

export async function profileByUser(userId) {
  const { rows } = await query(
    `SELECT dp.user_id, dp.vehicle_type, dp.car_make_model, dp.car_color, dp.plate_number,
            dp.commission_bp, dp.rating, dp.trips_completed, dp.status, dp.is_online,
            dp.last_seen_at, u.full_name, u.phone
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE dp.user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function setAvailability(userId, { isOnline, lat, lng }) {
  const { rows } = await query(
    `UPDATE driver_profiles
        SET is_online = $2,
            last_lat = COALESCE($3, last_lat),
            last_lng = COALESCE($4, last_lng),
            last_seen_at = now(),
            updated_at = now()
      WHERE user_id = $1
      RETURNING user_id, is_online, status, last_seen_at`,
    [userId, isOnline, lat ?? null, lng ?? null]
  );
  return rows[0] ?? null;
}

// Self-service application: a customer submits their vehicle details and becomes
// a PENDING driver. The profile row and the DRIVER role flip together in one
// transaction so a half-applied account (role without profile, or vice versa)
// can never exist. Returns the new profile row, or null when a profile already
// exists — the PK rejects a second application.
export async function createApplication({ userId, vehicleType, carMakeModel, carColor, plateNumber }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO driver_profiles
         (user_id, vehicle_type, car_make_model, car_color, plate_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, vehicle_type, car_make_model, car_color, plate_number,
                 commission_bp, rating, trips_completed, status, is_online,
                 created_at, updated_at`,
      [userId, vehicleType, carMakeModel, carColor, plateNumber]
    );
    await client.query(`UPDATE users SET role = 'DRIVER' WHERE id = $1`, [userId]);
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (err) {
    await client.query("ROLLBACK");
    // 23505 = unique_violation on the driver_profiles PK => already applied.
    if (err.code === "23505") return null;
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Admin roster ----------
// Every driver with their account identity, for the admin console. Ordered so
// the ones actually waiting on approval float to the top.
export async function listProfiles({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT dp.user_id, u.full_name, u.phone, u.email, u.created_at AS joined_at,
            dp.vehicle_type, dp.car_make_model, dp.car_color, dp.plate_number,
            dp.commission_bp, dp.rating, dp.trips_completed, dp.status, dp.is_online,
            dp.created_at, dp.updated_at
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE ($1::text IS NULL OR dp.status = $1)
      ORDER BY (dp.status = 'PENDING') DESC, dp.created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}

// Approve / suspend / re-queue a driver. Suspension also forces them offline so
// a suspended driver cannot keep receiving offers until they're reinstated.
export async function setStatus({ userId, status }) {
  const { rows } = await query(
    `UPDATE driver_profiles
        SET status = $2::varchar,
            is_online = CASE WHEN $2::varchar = 'ACTIVE' THEN is_online ELSE false END,
            updated_at = now()
      WHERE user_id = $1
      RETURNING user_id, status, is_online, updated_at`,
    [userId, status]
  );
  return rows[0] ?? null;
}

export async function earningsSummary(userId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(net_minor), 0) AS total_net_minor,
            COALESCE(SUM(commission_minor), 0) AS total_commission_minor,
            COUNT(*) AS trips
       FROM driver_earnings WHERE driver_user_id = $1`,
    [userId]
  );
  return rows[0];
}

export async function listEarnings(userId, limit = 50) {
  const { rows } = await query(
    `SELECT id, booking_kind, booking_id, gross_minor, commission_minor, net_minor,
            status, created_at
       FROM driver_earnings
      WHERE driver_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// ---------- Offers ----------

// Online, approved drivers to offer a ride to (rides are car-based; we don't
// filter by vehicle for rides). For dispatch we match the booking's vehicle.
export async function onlineDriversForRide() {
  const { rows } = await query(
    `SELECT user_id FROM driver_profiles
      WHERE status = 'ACTIVE' AND is_online = true`
  );
  return rows.map((r) => r.user_id);
}

export async function onlineDriversForVehicle(vehicleType) {
  const { rows } = await query(
    `SELECT user_id FROM driver_profiles
      WHERE status = 'ACTIVE' AND is_online = true AND vehicle_type = $1`,
    [vehicleType]
  );
  return rows.map((r) => r.user_id);
}

export async function createOffers({ kind, bookingId, driverUserIds, ttlSec = 30 }) {
  if (!driverUserIds.length) return 0;
  const { rowCount } = await query(
    `INSERT INTO driver_offers (booking_kind, booking_id, driver_user_id, expires_at)
     SELECT $1, $2, d, now() + make_interval(secs => $3)
       FROM unnest($4::uuid[]) AS d
     ON CONFLICT (booking_kind, booking_id, driver_user_id) DO NOTHING`,
    [kind, bookingId, ttlSec, driverUserIds]
  );
  return rowCount;
}

// A driver's live offers PLUS open (unassigned) jobs they could take. Both are
// returned in one shape so the dashboard treats them uniformly.
export async function listOffersAndOpen(userId, vehicleType) {
  const { rows: offerRows } = await query(
    `SELECT o.id AS offer_id, o.booking_kind AS kind, o.booking_id,
            o.expires_at, o.status AS offer_status,
            COALESCE(r.tier, d.item_type) AS label,
            COALESCE(r.pickup_address, d.pickup_address) AS pickup_address,
            COALESCE(r.dropoff_address, d.dropoff_address) AS dropoff_address,
            COALESCE(r.distance_km, d.distance_km) AS distance_km,
            COALESCE(r.est_duration_min, d.est_duration_min) AS est_duration_min,
            COALESCE(r.amount_minor, d.amount_minor) AS amount_minor,
            COALESCE(r.status, d.status) AS booking_status,
            COALESCE(r.created_at, d.created_at) AS created_at
       FROM driver_offers o
       LEFT JOIN ride_bookings r ON o.booking_kind = 'RIDE' AND r.id = o.booking_id
       LEFT JOIN dispatch_bookings d ON o.booking_kind = 'DISPATCH' AND d.id = o.booking_id
      WHERE o.driver_user_id = $1
        AND o.status = 'OFFERED'
        AND o.expires_at > now()
      ORDER BY o.created_at DESC`,
    [userId]
  );

  const { rows: openRides } = await query(
    `SELECT NULL::uuid AS offer_id, 'RIDE' AS kind, b.id AS booking_id,
            NULL::timestamptz AS expires_at, 'OPEN' AS offer_status,
            b.tier AS label, b.pickup_address, b.dropoff_address, b.distance_km,
            b.est_duration_min, b.amount_minor, b.status AS booking_status, b.created_at
       FROM ride_bookings b
      WHERE b.status = 'SEARCHING' AND b.driver_user_id IS NULL
      ORDER BY b.created_at DESC
      LIMIT 10`
  );

  const { rows: openDispatch } = await query(
    `SELECT NULL::uuid AS offer_id, 'DISPATCH' AS kind, b.id AS booking_id,
            NULL::timestamptz AS expires_at, 'OPEN' AS offer_status,
            b.item_type AS label, b.pickup_address, b.dropoff_address, b.distance_km,
            b.est_duration_min, b.amount_minor, b.status AS booking_status, b.created_at
       FROM dispatch_bookings b
      WHERE b.status = 'BOOKED' AND b.driver_user_id IS NULL AND b.vehicle_type = $1
      ORDER BY b.created_at DESC
      LIMIT 10`,
    [vehicleType]
  );

  // De-dupe: a booking that already has a live offer to this driver must not
  // also appear as an open job.
  const seen = new Set();
  const out = [];
  for (const row of [...offerRows, ...openRides, ...openDispatch]) {
    const key = `${row.kind}:${row.booking_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function markOfferResponded({ kind, bookingId, driverUserId, status }) {
  await query(
    `UPDATE driver_offers SET status = $4, responded_at = now()
      WHERE booking_kind = $1 AND booking_id = $2 AND driver_user_id = $3 AND status = 'OFFERED'`,
    [kind, bookingId, driverUserId, status]
  );
}

export async function expireOtherOffers({ kind, bookingId, exceptDriverId }) {
  await query(
    `UPDATE driver_offers SET status = 'EXPIRED', responded_at = now()
      WHERE booking_kind = $1 AND booking_id = $2 AND status = 'OFFERED'
        AND driver_user_id <> $3`,
    [kind, bookingId, exceptDriverId]
  );
}

export async function purgeExpiredOffers() {
  await query(
    `UPDATE driver_offers SET status = 'EXPIRED'
      WHERE status = 'OFFERED' AND expires_at <= now()`
  );
}

// A driver's assigned trips (ride + dispatch) in one shape, newest first.
export async function listTrips(userId, limit = 50) {
  const { rows } = await query(
    `SELECT 'RIDE' AS kind, b.id, b.status, b.tier AS label, b.pickup_address,
            b.dropoff_address, b.distance_km, b.amount_minor, b.created_at, b.updated_at
       FROM ride_bookings b WHERE b.driver_user_id = $1
     UNION ALL
     SELECT 'DISPATCH' AS kind, b.id, b.status, b.item_type AS label, b.pickup_address,
            b.dropoff_address, b.distance_km, b.amount_minor, b.created_at, b.updated_at
       FROM dispatch_bookings b WHERE b.driver_user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// ---------- Accept (atomic) ----------

// Assign the driver to a booking only if it is still unassigned in the expected
// state. The conditional UPDATE is the whole safety mechanism: two drivers
// racing both run it, exactly one gets rowCount 1.
export async function acceptBooking({ kind, bookingId, driver }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let result;
    if (kind === "RIDE") {
      result = await client.query(
        `UPDATE ride_bookings
            SET driver_user_id = $2, accepted_at = now(), status = 'DRIVER_ACCEPTED',
                driver_name = $3, driver_phone = $4, driver_car = $5, driver_color = $6,
                driver_plate = $7, driver_rating = $8, driver_trips = $9, updated_at = now()
          WHERE id = $1 AND status = 'SEARCHING' AND driver_user_id IS NULL
          RETURNING *`,
        [bookingId, driver.userId, driver.name, driver.phone, driver.car, driver.color,
         driver.plate, driver.rating, driver.trips]
      );
    } else {
      result = await client.query(
        `UPDATE dispatch_bookings
            SET driver_user_id = $2, accepted_at = now(), status = 'RIDER_ASSIGNED',
                rider_name = $3, rider_phone = $4, rider_vehicle = $5, rider_plate = $6,
                rider_rating = $7, rider_trips = $8, updated_at = now()
          WHERE id = $1 AND status = 'BOOKED' AND driver_user_id IS NULL
          RETURNING *`,
        [bookingId, driver.userId, driver.name, driver.phone, driver.car, driver.plate,
         driver.rating, driver.trips]
      );
    }

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "ALREADY_TAKEN" };
    }

    await client.query(
      `UPDATE driver_offers SET status = 'ACCEPTED', responded_at = now()
        WHERE booking_kind = $1 AND booking_id = $2 AND driver_user_id = $3 AND status = 'OFFERED'`,
      [kind, bookingId, driver.userId]
    );
    await client.query(
      `UPDATE driver_offers SET status = 'EXPIRED', responded_at = now()
        WHERE booking_kind = $1 AND booking_id = $2 AND status = 'OFFERED'
          AND driver_user_id <> $3`,
      [kind, bookingId, driver.userId]
    );

    await client.query("COMMIT");
    return { ok: true, booking: result.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Driver-owned status transitions (non-terminal) ----------

const TRANSITIONS = {
  RIDE: {
    arrived: ["DRIVER_ACCEPTED", "DRIVER_ARRIVING"],
    start: ["DRIVER_ARRIVING", "IN_PROGRESS"],
  },
  DISPATCH: {
    pickup: ["RIDER_ASSIGNED", "PICKED_UP"],
    transit: ["PICKED_UP", "IN_TRANSIT"],
  },
};

// Returns the updated booking, or { ok:false, code } when the transition isn't
// valid for THIS driver (wrong state, or not their booking).
export async function advanceTransition({ kind, bookingId, driverUserId, action }) {
  const spec = TRANSITIONS[kind]?.[action];
  if (!spec) return { ok: false, code: "UNKNOWN_ACTION" };
  const [from, to] = spec;
  const table = kind === "RIDE" ? "ride_bookings" : "dispatch_bookings";

  const { rows } = await query(
    `UPDATE ${table}
        SET status = $4, updated_at = now()
      WHERE id = $1 AND driver_user_id = $2 AND status = $3
      RETURNING *`,
    [bookingId, driverUserId, from, to]
  );
  if (rows.length === 0) return { ok: false, code: "INVALID_STATE" };
  return { ok: true, booking: rows[0] };
}

// ---------- Terminal transition + settlement (atomic) ----------

// Complete/deliver a booking: release the customer's escrowed fare, pay the
// driver their net, record the earning, and bump the driver's trip count — all
// in one transaction. Idempotent: the state guard plus the unique
// (booking_kind, booking_id) on driver_earnings make a retry a no-op.
export async function settleBooking({ kind, bookingId, driverUserId, otpCode, reference }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const table = kind === "RIDE" ? "ride_bookings" : "dispatch_bookings";
    const fromStatus = kind === "RIDE" ? "IN_PROGRESS" : "IN_TRANSIT";
    const toStatus = kind === "RIDE" ? "COMPLETED" : "DELIVERED";

    const current = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    const booking = current.rows[0];
    if (!booking || booking.driver_user_id !== driverUserId || booking.status !== fromStatus) {
      await client.query("ROLLBACK");
      return { ok: false, code: "INVALID_STATE" };
    }

    // Delivery code gate (dispatch only).
    if (kind === "DISPATCH") {
      if (sha256(String(otpCode ?? "")) !== booking.delivery_otp_hash) {
        await client.query("ROLLBACK");
        return { ok: false, code: "INVALID_OTP" };
      }
    }

    await client.query(
      `UPDATE ${table} SET status = $2, updated_at = now() WHERE id = $1`,
      [bookingId, toStatus]
    );

    // Release escrow: the customer's PENDING hold becomes final.
    await client.query(
      `UPDATE transactions SET status = 'SUCCESS', completed_at = now()
        WHERE id = $1 AND status = 'PENDING'`,
      [booking.transaction_id]
    );

    // Settlement maths.
    const gross = Number(booking.amount_minor);
    const prof = await client.query(
      `SELECT commission_bp FROM driver_profiles WHERE user_id = $1`,
      [driverUserId]
    );
    const commissionBp = Number(prof.rows[0]?.commission_bp ?? 1500);
    const commission = Math.round((gross * commissionBp) / 10000);
    const net = gross - commission;

    const walletRes = await client.query(
      `SELECT id, status FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [driverUserId]
    );
    const wallet = walletRes.rows[0];
    if (!wallet) {
      await client.query("ROLLBACK");
      return { ok: false, code: "DRIVER_WALLET_MISSING" };
    }

    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [net, wallet.id]
    );

    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, receiver_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'DRIVER_EARNING', 'SUCCESS', $5, now())
       ON CONFLICT (receiver_wallet_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL AND type = 'DRIVER_EARNING' DO NOTHING
       RETURNING id`,
      [reference, `earn:${kind}:${bookingId}`, wallet.id, net,
       `${kind === "RIDE" ? "Ride" : "Delivery"} earning`]
    );

    await client.query(
      `INSERT INTO driver_earnings
         (driver_user_id, booking_kind, booking_id, gross_minor, commission_minor,
          net_minor, status, transaction_id, settled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'SETTLED', $7, now())
       ON CONFLICT (booking_kind, booking_id) DO NOTHING`,
      [driverUserId, kind, bookingId, gross, commission, net, ledger.rows[0]?.id ?? null]
    );

    await client.query(
      `UPDATE driver_profiles
          SET trips_completed = trips_completed + 1, updated_at = now()
        WHERE user_id = $1`,
      [driverUserId]
    );

    const refreshed = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [bookingId]);
    await client.query("COMMIT");
    return { ok: true, booking: refreshed.rows[0], gross, commission, net };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
