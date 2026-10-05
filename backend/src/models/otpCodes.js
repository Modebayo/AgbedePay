// otp_codes model — every SQL statement about OTP codes lives here.

import { query } from "../config/db.js";

export async function create({ phone, purpose, codeHash, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, phone, purpose, expires_at, created_at`,
    [phone, purpose, codeHash, expiresAt]
  );
  return rows[0];
}

// The most recent, not-yet-consumed code for a phone + purpose.
export async function findLatest(phone, purpose) {
  const { rows } = await query(
    `SELECT id, phone, purpose, code_hash, attempts, consumed_at, expires_at, created_at
       FROM otp_codes
      WHERE phone = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose]
  );
  return rows[0] ?? null;
}

export async function incrementAttempts(id) {
  await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [id]);
}

export async function markConsumed(id) {
  await query(
    `UPDATE otp_codes SET consumed_at = now(), attempts = attempts + 1 WHERE id = $1`,
    [id]
  );
}