// OTP business logic — generation, expiration, attempt limits, cooldowns.
// Only the HASH of a code is stored and compared; the plain code is never saved.

import * as otpModel from "../models/otpCodes.js";
import { otpProvider } from "../providers/index.js";
import { generateOtp, sha256 } from "../utils/crypto.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

export async function issueOtp({ phone, purpose }) {
  // Resend cooldown: don't allow spam — an active (unused) code must be
  // at least 60s old before we issue another one.
  const latest = await otpModel.findLatest(phone, purpose);
  if (latest && !latest.consumed_at) {
    const ageSeconds = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    if (ageSeconds < RESEND_COOLDOWN_SECONDS) {
      throw new ApiError(
        429,
        `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - ageSeconds)}s before requesting another code`,
        "RATE_LIMITED"
      );
    }
  }

  const code = generateOtp();
  const codeHash = sha256(code); // store only the hash
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await otpModel.create({ phone, purpose, codeHash, expiresAt });
  await otpProvider.send({ phone, code, purpose }); // mock prints to console; termii sends a real SMS

  return { ttlMinutes: OTP_TTL_MINUTES, maxAttempts: OTP_MAX_ATTEMPTS };
}

// Verify a submitted code. On success we mark it consumed: one code = one use.
export async function consumeOtp({ phone, purpose, code }) {
  const record = await otpModel.findLatest(phone, purpose);

  if (!record || record.consumed_at) {
    throw new ApiError(400, "Invalid or already-used code", "OTP_INVALID");
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new ApiError(400, "This code has expired", "OTP_EXPIRED");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many attempts — request a new code", "OTP_ATTEMPTS_EXCEEDED");
  }

  if (sha256(code) !== record.code_hash) {
    await otpModel.incrementAttempts(record.id);
    const remaining = OTP_MAX_ATTEMPTS - record.attempts - 1;
    throw new ApiError(
      400,
      `Incorrect code. ${Math.max(remaining, 0)} attempt(s) left.`,
      "OTP_INVALID"
    );
  }

  await otpModel.markConsumed(record.id);
  return true;
}