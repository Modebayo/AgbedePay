// adminModel — the cross-module READ model behind the admin console.
//
// Every other model owns exactly one domain. The admin overview is the
// deliberate exception: it takes a few numbers out of every table so an
// operator can see the whole platform at a glance. Only that dashboard SQL
// lives here; the per-record list/write queries stay with their own domain
// models (driverModel, cargoQuotes, supportTickets, payments).

import { query } from "../config/db.js";

// The console must not fall over just because one module's migration hasn't
// been applied to this database yet. A missing table (42P01) or column (42703)
// degrades that single metric to its fallback; every other number still renders.
async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === "42P01" || err?.code === "42703") return fallback;
    throw err;
  }
}

const one = async (sql) => {
  const { rows } = await query(sql);
  return rows[0] ?? null;
};

const ZERO_USERS = { total: 0, active: 0, suspended: 0, pending: 0, drivers: 0, admins: 0, new_7d: 0 };
const ZERO_WALLETS = { total: 0, total_balance_minor: 0, frozen: 0 };
const ZERO_TX = {
  total: 0, success: 0, failed: 0, pending: 0, today: 0,
  volume_7d_minor: 0, volume_all_minor: 0,
};
const ZERO_RIDES = { total: 0, active: 0, completed: 0, cancelled: 0 };
const ZERO_DISPATCH = { total: 0, active: 0, delivered: 0, cancelled: 0 };
const ZERO_DRIVERS = { total: 0, pending: 0, active: 0, suspended: 0, online: 0 };
const ZERO_CARGO = { total: 0, requested: 0, quoted: 0, accepted: 0, closed: 0 };
const ZERO_PAYMENTS = { total: 0, pending: 0, success: 0, failed: 0, collected_minor: 0 };
const ZERO_SUPPORT = { total: 0, open: 0, in_progress: 0, resolved: 0 };

export async function overview() {
  const [users, wallets, transactions, txByType, rides, dispatch, drivers, cargo, payments, support] =
    await Promise.all([
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
            count(*) FILTER (WHERE status = 'PENDING_VERIFICATION')::int AS pending,
            count(*) FILTER (WHERE role = 'DRIVER')::int AS drivers,
            count(*) FILTER (WHERE role = 'ADMIN')::int AS admins,
            count(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days')::int AS new_7d
          FROM users`),
        ZERO_USERS
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            COALESCE(sum(balance_minor), 0)::bigint AS total_balance_minor,
            count(*) FILTER (WHERE status = 'FROZEN')::int AS frozen
          FROM wallets`),
        ZERO_WALLETS
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'SUCCESS')::int AS success,
            count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
            count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE created_at >= current_date)::int AS today,
            COALESCE(sum(amount_minor) FILTER (WHERE status = 'SUCCESS' AND created_at >= now() - INTERVAL '7 days'), 0)::bigint AS volume_7d_minor,
            COALESCE(sum(amount_minor) FILTER (WHERE status = 'SUCCESS'), 0)::bigint AS volume_all_minor
          FROM transactions`),
        ZERO_TX
      ),
      safe(async () => {
        const { rows } = await query(
          `SELECT type,
                  count(*)::int AS count,
                  COALESCE(sum(amount_minor), 0)::bigint AS amount_minor
             FROM transactions
            WHERE status = 'SUCCESS'
            GROUP BY type
            ORDER BY count DESC`
        );
        return rows;
      }, []),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('SEARCHING','DRIVER_ACCEPTED','DRIVER_ARRIVING','IN_PROGRESS'))::int AS active,
            count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
            count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
          FROM ride_bookings`),
        ZERO_RIDES
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('BOOKED','RIDER_ASSIGNED','PICKED_UP','IN_TRANSIT'))::int AS active,
            count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
            count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
          FROM dispatch_bookings`),
        ZERO_DISPATCH
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
            count(*) FILTER (WHERE is_online)::int AS online
          FROM driver_profiles`),
        ZERO_DRIVERS
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'REQUESTED')::int AS requested,
            count(*) FILTER (WHERE status = 'QUOTED')::int AS quoted,
            count(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
            count(*) FILTER (WHERE status = 'CLOSED')::int AS closed
          FROM cargo_quotes`),
        ZERO_CARGO
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE status = 'SUCCESS')::int AS success,
            count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
            COALESCE(sum(amount_minor) FILTER (WHERE status = 'SUCCESS'), 0)::bigint AS collected_minor
          FROM payment_transactions`),
        ZERO_PAYMENTS
      ),
      safe(
        () =>
          one(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'OPEN')::int AS open,
            count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved
          FROM support_tickets`),
        ZERO_SUPPORT
      ),
    ]);

  return { users, wallets, transactions, txByType, rides, dispatch, drivers, cargo, payments, support };
}

// A short "what just happened" feed for the overview: the newest ledger rows
// (with whose wallet they touched) and the newest sign-ups.
export async function recentActivity({ txLimit = 8, userLimit = 5 } = {}) {
  const [transactions, users] = await Promise.all([
    safe(async () => {
      const { rows } = await query(
        `SELECT t.id, t.reference, t.type, t.status, t.amount_minor, t.created_at,
                u.full_name AS user_name
           FROM transactions t
           JOIN wallets w ON w.id = COALESCE(t.receiver_wallet_id, t.sender_wallet_id)
           JOIN users u ON u.id = w.user_id
          ORDER BY t.created_at DESC
          LIMIT $1`,
        [txLimit]
      );
      return rows;
    }, []),
    safe(async () => {
      const { rows } = await query(
        `SELECT id, full_name, phone, role, status, created_at
           FROM users
          ORDER BY created_at DESC
          LIMIT $1`,
        [userLimit]
      );
      return rows;
    }, []),
  ]);

  return { transactions, users };
}
