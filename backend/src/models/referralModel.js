// referral model — the ONLY place SQL about referrals lives.
// A referral row links a referrer to one referred user; the UNIQUE(referred_id)
// constraint plus the status column make the bonus credit exactly-once.

import { query } from "../config/db.js";

// Atomically claim a PENDING referral for this referred user. Only one caller
// wins the compare-and-set; everyone else gets null (bonus already handled).
export async function claimPending(referredId) {
  const { rows } = await query(
    `UPDATE referrals SET status = 'CREDITED', credited_at = now()
      WHERE referred_id = $1 AND status = 'PENDING'
      RETURNING id, referrer_id, referred_id`,
    [referredId]
  );
  return rows[0] ?? null;
}

export async function createReferral({ referrerId, referredId }) {
  const { rows } = await query(
    `INSERT INTO referrals (referrer_id, referred_id)
     VALUES ($1, $2)
     ON CONFLICT (referred_id) DO NOTHING
     RETURNING id, referrer_id, referred_id, status`,
    [referrerId, referredId]
  );
  return rows[0] ?? null;
}

export async function getStats(referrerId) {
  const { rows } = await query(
    `SELECT count(*)::int AS referred,
            count(*) FILTER (WHERE status = 'CREDITED')::int AS credited
       FROM referrals
      WHERE referrer_id = $1`,
    [referrerId]
  );
  return { referred: rows[0]?.referred ?? 0, credited: rows[0]?.credited ?? 0 };
}

export async function findByReferredId(referredId) {
  const { rows } = await query(
    `SELECT id, referrer_id, referred_id, status, created_at
       FROM referrals
      WHERE referred_id = $1`,
    [referredId]
  );
  return rows[0] ?? null;
}