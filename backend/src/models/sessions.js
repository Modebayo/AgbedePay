// sessions model — every SQL statement about sessions lives here.
// The database stores ONLY the SHA-256 hash of a token, never the token.

import { query } from "../config/db.js";

export async function create({ userId, tokenHash, deviceInfo, ipAddress, userAgent, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO sessions (user_id, token_hash, device_info, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, expires_at, created_at`,
    [userId, tokenHash, deviceInfo, ipAddress, userAgent, expiresAt]
  );
  return rows[0];
}

// Returns a VALID (unrevoked, unexpired) session with its user attached,
// or null. Used by the auth middleware for every protected request. Touches
// last_seen_at so the "active sessions" screen is honest about device use.
export async function findValidByTokenHash(tokenHash) {
  const { rows } = await query(
    `UPDATE sessions s
        SET last_seen_at = now()
       FROM users u
      WHERE s.token_hash = $1
        AND u.id = s.user_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      RETURNING s.id AS session_id, s.expires_at, s.revoked_at,
                u.id AS user_id, u.full_name, u.phone, u.email, u.status, u.is_verified`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

// All of a user's LIVE sessions for the "manage devices" screen. The current
// session is flagged by the caller; it can never be revoked from here.
export async function listByUser(userId) {
  const { rows } = await query(
    `SELECT id, device_info, ip_address, user_agent, expires_at, created_at, last_seen_at
       FROM sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY (last_seen_at IS NULL), last_seen_at DESC, created_at DESC`,
    [userId]
  );
  return rows;
}

export async function revokeById(id) {
  const { rows } = await query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

// Same as revokeById but only revokes a session belonging to THIS user — so a
// session id from another account can never be targeted by guessing a UUID.
export async function revokeOwnedById(id, userId) {
  const { rows } = await query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

export async function revokeAllForUser(userId) {
  await query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}