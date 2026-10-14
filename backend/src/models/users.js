// users model — the ONLY place SQL about users lives.
// Note: we NEVER select pin_hash here. Auth code (Phase 5) will have its own
// dedicated query so the hash can never leak through a profile response.

import { query } from "../config/db.js";

export async function findAll() {
  const { rows } = await query(
    `SELECT id, full_name, phone, email, status, is_verified,
            referral_code, login_otp_enabled, security_alert_enabled,
            created_at, updated_at
       FROM users
      ORDER BY created_at DESC`
  );
  return rows;
}

export async function findByPhone(phone) {
  const { rows } = await query(
    `SELECT id, full_name, phone, email, status, is_verified,
            referral_code, login_otp_enabled, security_alert_enabled,
            created_at, updated_at
       FROM users
      WHERE phone = $1`,
    [phone]
  );
  return rows[0] ?? null;
}

export async function findByUserId(id) {
  const { rows } = await query(
    `SELECT id, full_name, phone, email, status, is_verified,
            referral_code, login_otp_enabled, security_alert_enabled,
            avatar_filename, avatar_mime, avatar_updated_at,
            created_at, updated_at
       FROM users
      WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// The user's 10-digit AgbedePay account number (migration 036). Kept out of the
// core profile SELECT on purpose, so the profile endpoint keeps working before
// that migration is applied — the caller guards this the same way it guards role.
export async function getAccountNumberById(id) {
  const { rows } = await query(`SELECT account_number FROM users WHERE id = $1`, [id]);
  return rows[0]?.account_number ?? null;
}

// Resolve the owner of a 10-digit AgbedePay account number. Used by the
// name-enquiry preview and by account-number wallet transfers.
export async function findByAccountNumber(accountNumber) {
  const { rows } = await query(
    `SELECT id, full_name, phone, status, account_number
       FROM users
      WHERE account_number = $1`,
    [accountNumber]
  );
  return rows[0] ?? null;
}

// Role lookup (CUSTOMER / DRIVER / ADMIN). Kept out of the session query on
// purpose: role-guarded endpoints pay for this tiny read, and unrelated
// endpoints keep working even before the roles migration is applied.
export async function getRoleById(id) {
  const { rows } = await query(`SELECT role FROM users WHERE id = $1`, [id]);
  return rows[0]?.role ?? null;
}

export async function findByReferralCode(code) {  const { rows } = await query(
    `SELECT id, full_name, phone, status, referral_code
       FROM users
      WHERE referral_code = $1`,
    [code]
  );
  return rows[0] ?? null;
}

export async function rename(phone, fullName) {
  const { rows } = await query(
    `UPDATE users
        SET full_name = $2
      WHERE phone = $1
      RETURNING id, full_name, phone, email, status, is_verified, updated_at`,
    [phone, fullName]
  );
  return rows[0] ?? null;
}

// ---- Auth-specific operations -----------------------------------------
// These are the ONLY functions allowed to touch pin_hash.

export async function createUser({ fullName, phone, email, pinHash, referralCode }) {
  const { rows } = await query(
    `INSERT INTO users (full_name, phone, email, pin_hash, referral_code, status, is_verified)
     VALUES ($1, $2, $3, $4, COALESCE($5, upper(substr(md5(gen_random_uuid()::text), 1, 8))), 'ACTIVE', true)
     RETURNING id, full_name, phone, email, status, is_verified, referral_code, created_at`,
    [fullName, phone, email ?? null, pinHash, referralCode ?? null]
  );
  return rows[0];
}

// Security-adjacent toggle: require an extra OTP code at login.
export async function setLoginOtp(userId, enabled) {
  const { rows } = await query(
    `UPDATE users SET login_otp_enabled = $2 WHERE id = $1 RETURNING id, login_otp_enabled`,
    [userId, enabled]
  );
  return rows[0] ?? null;
}

// Security-adjacent toggle: notify (in-app) when a NEW device signs in.
export async function setSecurityAlert(userId, enabled) {
  const { rows } = await query(
    `UPDATE users SET security_alert_enabled = $2 WHERE id = $1 RETURNING id, security_alert_enabled`,
    [userId, enabled]
  );
  return rows[0] ?? null;
}

// PRIVATE — returns pin_hash. Only the auth service may call this.
export async function findByPhoneWithPin(phone) {
  const { rows } = await query(`SELECT * FROM users WHERE phone = $1`, [phone]);
  return rows[0] ?? null;
}

// PRIVATE — returns pin_hash by user id. Same rule as findByPhoneWithPin:
// only auth + money-movement services (which re-verify the PIN) may call it.
export async function findByIdWithPin(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function setVerified(userId) {
  const { rows } = await query(
    `UPDATE users SET is_verified = true, status = 'ACTIVE'
      WHERE id = $1
      RETURNING id, status, is_verified`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function updatePinHash(userId, pinHash) {
  const { rows } = await query(
    `UPDATE users SET pin_hash = $2 WHERE id = $1 RETURNING id, updated_at`,
    [userId, pinHash]
  );
  return rows[0] ?? null;
}

// ---- KYC / bio data -------------------------------------------------------

// Returns the personal-profile fields WITHOUT identity_hash (never exposed).
export async function findUserWithKyc(userId) {
  const { rows } = await query(
    `SELECT id, full_name, phone, email, date_of_birth, gender, address, city, state,
            occupation, next_of_kin_name, next_of_kin_phone, next_of_kin_relation,
            identity_type, verification_level, verified_at
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

// Persist bio data. verification_level follows automatically: identity wins,
// then bio-complete => BASIC, otherwise NONE. Completeness is computed from the
// MERGED profile (existing values + this update) so a partial edit can't
// downgrade an already-complete profile.
export async function updateBio(
  userId,
  { fullName, email, dateOfBirth, gender, address, city, state, occupation, nextOfKinName, nextOfKinPhone, nextOfKinRelation }
) {
  const current = await query(
    `SELECT email, date_of_birth, gender, address, city, state,
            occupation, next_of_kin_name, next_of_kin_phone, next_of_kin_relation
       FROM users WHERE id = $1`,
    [userId]
  );
  const cur = current.rows[0] ?? {};
  const merged = {
    email: email ?? cur.email,
    dateOfBirth: dateOfBirth ?? cur.date_of_birth,
    gender: gender ?? cur.gender,
    address: address ?? cur.address,
    city: city ?? cur.city,
    state: state ?? cur.state,
    occupation: occupation ?? cur.occupation,
    nextOfKinName: nextOfKinName ?? cur.next_of_kin_name,
    nextOfKinPhone: nextOfKinPhone ?? cur.next_of_kin_phone,
    nextOfKinRelation: nextOfKinRelation ?? cur.next_of_kin_relation,
  };
  const bioComplete = Boolean(
    merged.dateOfBirth && merged.gender && merged.address && merged.city && merged.state &&
    merged.occupation && merged.nextOfKinName && merged.nextOfKinPhone && merged.nextOfKinRelation
  );

  const { rows } = await query(
    `UPDATE users
        SET full_name = $2, email = $3, date_of_birth = $4::date, gender = $5,
            address = $6, city = $7, state = $8, occupation = $9,
            next_of_kin_name = $10, next_of_kin_phone = $11, next_of_kin_relation = $12,
            verification_level = CASE
              WHEN identity_hash IS NOT NULL THEN 'IDENTITY_VERIFIED'
              WHEN $13 THEN 'BASIC'
              ELSE 'NONE'
            END
      WHERE id = $1
      RETURNING id, full_name, email, date_of_birth, gender, address, city, state,
                occupation, next_of_kin_name, next_of_kin_phone, next_of_kin_relation, verification_level`,
    [userId, fullName, merged.email, merged.dateOfBirth ?? null, merged.gender ?? null,
     merged.address ?? null, merged.city ?? null, merged.state ?? null,
     merged.occupation ?? null, merged.nextOfKinName ?? null,
     merged.nextOfKinPhone ?? null, merged.nextOfKinRelation ?? null, bioComplete]
  );
  return rows[0] ?? null;
}

// ---- Avatar ----------------------------------------------------------------

/**
 * Stores the avatar reference on the user row.
 *
 * Returns the PREVIOUS filename alongside the new one, because the caller has to
 * unlink the old file from disk and the row we just overwrote was the only place
 * that knew its name. A CTE captures the old value atomically, which is what
 * makes this safe under concurrent uploads: each request learns exactly what it
 * replaced. A request that replaced nothing gets null back and deletes nothing,
 * so two simultaneous uploads can never each delete the other's file and leave
 * the row pointing at a file that is gone.
 */
export async function setAvatar(userId, { filename, mime, sizeBytes }) {
  const { rows } = await query(
    `WITH previous AS (
       SELECT avatar_filename FROM users WHERE id = $1
     )
     UPDATE users u
        SET avatar_filename = $2,
            avatar_mime = $3,
            avatar_size_bytes = $4,
            avatar_updated_at = now()
      WHERE u.id = $1
     RETURNING u.id, u.full_name,
               u.avatar_filename, u.avatar_mime, u.avatar_size_bytes, u.avatar_updated_at,
               (SELECT avatar_filename FROM previous) AS previous_filename`,
    [userId, filename, mime, sizeBytes]
  );
  const row = rows[0] ?? null;
  if (!row) return null;
  return { ...row, previousFilename: row.previous_filename ?? null };
}

/**
 * Clears the avatar reference. Returns the filename that was set, so the caller
 * can unlink it.
 */
export async function clearAvatar(userId) {
  // The previous filename is captured in a CTE BEFORE the UPDATE overwrites it.
  // Returning avatar_filename straight from the UPDATE would always be NULL,
  // because RETURNING exposes post-update values — which would silently skip
  // the unlink and leave the file on disk forever.
  const { rows } = await query(
    `WITH previous AS (
       SELECT avatar_filename FROM users WHERE id = $1
     )
     UPDATE users u
        SET avatar_filename = NULL,
            avatar_mime = NULL,
            avatar_size_bytes = NULL,
            avatar_updated_at = now()
      WHERE u.id = $1
     RETURNING u.id, u.full_name,
               (SELECT avatar_filename FROM previous) AS previous_filename`,
    [userId]
  );
  return rows[0] ?? null;
}

// Persist a successful identity verification. The NUMBER itself is stored
// only as a SHA-256 hash so a leaked database never leaks the NIN/BVN.
export async function updateIdentity(userId, { identityType, identityHash }) {  const { rows } = await query(
    `UPDATE users
        SET identity_type = $2, identity_hash = $3,
            verification_level = 'IDENTITY_VERIFIED', verified_at = now()
      WHERE id = $1
      RETURNING id, identity_type, verification_level, verified_at`,
    [userId, identityType, identityHash]
  );
  return rows[0] ?? null;
}