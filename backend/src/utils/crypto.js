// Cryptographic helpers.
//  - PINs:  Argon2id (slow, memory-hard — the current best password hash).
//  - OTPs/tokens: SHA-256 (fast one-way hash; ok because these values are
//    high-entropy random strings, unlike human-chosen PINs).

import crypto from "node:crypto";
import argon2 from "argon2";

// ---- PINs (Argon2id) ----

export async function hashPin(pin) {
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPin(hash, pin) {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false; // malformed hash etc. — never let this throw
  }
}

// ---- Tokens & OTP codes ----

// One-way hash used for session tokens & OTP codes stored in the DB.
// We never store the raw value, so a database leak doesn't expose them.
export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Cryptographically-random opaque token (64 hex chars by default).
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

// Cryptographically-random 6-digit OTP code.
export function generateOtp(length = 6) {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}