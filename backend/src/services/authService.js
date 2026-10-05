// auth service — ALL authentication business rules live here.
// Controllers stay thin; sensitive logic (PIN hashing, session creation,
// OTP consumption) happens in this layer only.

import * as userModel from "../models/users.js";
import * as walletModel from "../models/wallets.js";
import * as sessionModel from "../models/sessions.js";
import * as auditModel from "../models/audit.js";
import * as referralModel from "../models/referralModel.js";
import { hashPin, verifyPin, sha256, randomToken } from "../utils/crypto.js";
import { issueOtp, consumeOtp } from "./otpService.js";
import { notify } from "./notificationsService.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { env } from "../config/env.js";

// ---------- Registration ----------

export async function register({ fullName, phone, email, pin, confirmPin, ipAddress, userAgent, referralCode }) {
  if (String(pin) !== String(confirmPin)) {
    throw new ApiError(400, "PINs do not match", "PIN_MISMATCH");
  }

  const existing = await userModel.findByPhone(phone);
  if (existing) {
    throw new ApiError(409, "An account with this phone number already exists", "CONFLICT");
  }

  // The referral code is validated BEFORE the account is created so a bad code
  // can never leave an orphan user behind.
  let referrer = null;
  if (referralCode) {
    referrer = await userModel.findByReferralCode(String(referralCode).trim().toUpperCase());
    if (!referrer) {
      throw new ApiError(400, "Invalid referral code", "INVALID_REFERRAL");
    }
  }

  const pinHash = await hashPin(pin);
  const user = await userModel.createUser({ fullName, phone, email, pinHash });
  await walletModel.createForUser(user.id);

  if (referrer) {
    await referralModel.createReferral({ referrerId: referrer.id, referredId: user.id });
  }

  await issueOtp({ phone, purpose: "REGISTRATION" });

  await auditModel.record({
    userId: user.id,
    action: "REGISTER",
    entityType: "USER",
    entityId: user.id,
    metadata: { referred: referrer ? true : false },
    ipAddress,
    userAgent,
  });

  return { userId: user.id, status: user.status, referralCode: user.referral_code };
}

export async function verifyRegistrationOtp({ phone, code, ipAddress, userAgent }) {
  await consumeOtp({ phone, purpose: "REGISTRATION", code });
  const user = await userModel.findByPhone(phone);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  const updated = await userModel.setVerified(user.id);

  await auditModel.record({
    userId: user.id,
    action: "OTP_VERIFIED",
    entityType: "USER",
    entityId: user.id,
    metadata: { purpose: "REGISTRATION" },
    ipAddress,
    userAgent,
  });

  return { userId: user.id, status: updated.status, isVerified: updated.is_verified };
}

// ---------- Login / logout ----------

// Session creation shared by normal login and the security-code variant,
// so both paths behave identically (fresh httpOnly cookie, audit trail).
// If the holder opted into security alerts, a NEW device (one whose UA has
// never been seen in a live session) gets an in-app SECURITY notice.
async function createSession(user, { ipAddress, userAgent }) {
  const token = randomToken(32);
  const tokenHash = sha256(token); // the DB stores only the hash

  // Devices we already know about — compared AFTER the session is created so
  // this very session never counts as its own "prior" sighting.
  const knownDevices = user.security_alert_enabled
    ? new Set((await sessionModel.listByUser(user.id)).map((s) => s.device_info ?? ""))
    : null;

  const session = await sessionModel.create({
    userId: user.id,
    tokenHash,
    deviceInfo: userAgent ?? null,
    ipAddress,
    userAgent,
    expiresAt: new Date(Date.now() + env.sessionTtlMs),
  });

  await auditModel.record({
    userId: user.id,
    action: "LOGIN",
    entityType: "SESSION",
    entityId: session.id,
    ipAddress,
    userAgent,
  });

  if (knownDevices && !knownDevices.has(userAgent ?? "")) {
    await notify({
      userId: user.id,
      type: "SECURITY",
      link: "profile.html",
      title: "New device signed in",
      body: `IP ${ipAddress ?? "unknown"} · ${String(userAgent ?? "unknown device").slice(0, 160)}. If this wasn't you, sign that device out from Profile → Your devices.`,
    });
  }

  return {
    token, // delivered to the browser once, inside an httpOnly cookie
    sessionId: session.id,
    expiresAt: session.expires_at,
    user: {
      id: user.id,
      fullName: user.full_name,
      phone: user.phone,
      email: user.email,
    },
  };
}

export async function login({ phone, pin, ipAddress, userAgent }) {
  const user = await userModel.findByPhoneWithPin(phone);

  // A fake Argon2 hash is still verified when the user doesn't exist, so that
  // "wrong phone" and "wrong PIN" take about the same time — this makes it
  // harder to discover which accounts exist.
  const ok = user
    ? await verifyPin(user.pin_hash, pin)
    : await verifyPin(
        "$argon2id$v=19$m=19456,t=2,p=1$MDAwMDAwMDAwMDAwMDAwMA$mJC3d9HHGYpZVvsvxvD2l1MXN9I1Yb/oB+0tZx7l1sQ",
        pin
      ).catch(() => false);

  if (!user || !ok) {
    await auditModel.record({
      userId: user?.id ?? null,
      action: "LOGIN_FAILED",
      metadata: { phone }, // never log the PIN
      ipAddress,
      userAgent,
    });
    throw new ApiError(401, "Invalid phone number or PIN", "INVALID_CREDENTIALS");
  }

  if (!user.is_verified) {
    throw new ApiError(403, "Account not verified — complete OTP verification", "ACCOUNT_NOT_VERIFIED");
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, `Account is ${user.status.toLowerCase()}`, "ACCOUNT_DISABLED");
  }

  // Optional security code: the account-holder asked for a second factor. The
  // code is issued but NO session is created until they prove it.
  if (user.login_otp_enabled) {
    await issueOtp({ phone, purpose: "LOGIN" });
    await auditModel.record({
      userId: user.id,
      action: "LOGIN_OTP_ISSUED",
      ipAddress,
      userAgent,
    });
    return {
      requiresOtp: true,
      phone,
      message: "Security code required — check the server console for your DEV/MOCK code.",
    };
  }

  return createSession(user, { ipAddress, userAgent });
}

export async function completeLoginWithOtp({ phone, code, ipAddress, userAgent }) {
  await consumeOtp({ phone, purpose: "LOGIN", code });

  const user = await userModel.findByPhoneWithPin(phone);
  if (!user) {
    throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, `Account is ${user.status.toLowerCase()}`, "ACCOUNT_DISABLED");
  }

  return createSession(user, { ipAddress, userAgent });
}

export async function setLoginOtpEnabled({ userId, enabled, ipAddress, userAgent }) {
  const turnedOn = Boolean(enabled);
  await userModel.setLoginOtp(userId, turnedOn);
  await auditModel.record({
    userId,
    action: turnedOn ? "LOGIN_OTP_ENABLED" : "LOGIN_OTP_DISABLED",
    entityType: "USER",
    entityId: userId,
    ipAddress,
    userAgent,
  });
  return { loginOtpEnabled: turnedOn };
}

// Opt in/out of the "new device signed in" notice. This is a preference, not
// money movement — no PIN required, but it is audited either way.
export async function setSecurityAlertEnabled({ userId, enabled, ipAddress, userAgent }) {
  const turnedOn = Boolean(enabled);
  await userModel.setSecurityAlert(userId, turnedOn);
  await auditModel.record({
    userId,
    action: turnedOn ? "SECURITY_ALERT_ENABLED" : "SECURITY_ALERT_DISABLED",
    entityType: "USER",
    entityId: userId,
    ipAddress,
    userAgent,
  });
  return { securityAlertEnabled: turnedOn };
}

export async function logout({ sessionId, userId, ipAddress, userAgent }) {
  await sessionModel.revokeById(sessionId);
  await auditModel.record({
    userId,
    action: "LOGOUT",
    entityType: "SESSION",
    entityId: sessionId,
    ipAddress,
    userAgent,
  });
}

// ---------- Session manager (Security → "Your devices") ----------

// Lists every LIVE session so the user can see which devices are signed in.
// The current session is flagged, and revoking it from here is rejected — use
// Log out for the device in your hand.
export async function listSessions({ userId, currentSessionId, ipAddress, userAgent }) {
  const sessions = await sessionModel.listByUser(userId);
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      deviceInfo: s.device_info,
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
    })),
  };
}

export async function revokeSession({ sessionId, currentSessionId, userId, ipAddress, userAgent }) {
  if (sessionId === currentSessionId) {
    throw new ApiError(400, "Use Log out to end the session you're on right now", "SESSION_CURRENT");
  }
  const revoked = await sessionModel.revokeOwnedById(sessionId, userId);
  if (!revoked) throw new ApiError(404, "That session no longer exists or was already signed out", ErrorCodes.NOT_FOUND);

  await auditModel.record({
    userId,
    action: "SESSION_REVOKED",
    entityType: "SESSION",
    entityId: sessionId,
    ipAddress,
    userAgent,
  });

  return { revoked: true };
}

// ---------- Forgot / reset PIN ----------

export async function forgotPin({ phone, ipAddress, userAgent }) {
  const user = await userModel.findByPhone(phone);
  // Generic answer whether or not the account exists (don't leak existence).
  if (user) {
    await issueOtp({ phone, purpose: "FORGOT_PIN" });
    await auditModel.record({
      userId: user.id,
      action: "FORGOT_PIN_REQUESTED",
      ipAddress,
      userAgent,
    });
  }
  return { message: "If an account exists for that phone number, a reset code was issued." };
}

export async function resetPin({ phone, code, pin, confirmPin, ipAddress, userAgent }) {
  if (String(pin) !== String(confirmPin)) {
    throw new ApiError(400, "PINs do not match", "PIN_MISMATCH");
  }

  await consumeOtp({ phone, purpose: "FORGOT_PIN", code });

  const user = await userModel.findByPhone(phone);
  if (!user) throw new ApiError(400, "Invalid reset request", "OTP_INVALID");

  const pinHash = await hashPin(pin);
  await userModel.updatePinHash(user.id, pinHash);
  // Security: a stolen session must die with the old PIN.
  await sessionModel.revokeAllForUser(user.id);

  await auditModel.record({
    userId: user.id,
    action: "PIN_RESET",
    entityType: "USER",
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  return { message: "PIN reset successful. Please log in again." };
}

export async function resendOtp({ phone, purpose, ipAddress, userAgent }) {
  const user = await userModel.findByPhone(phone);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  await issueOtp({ phone, purpose });
  await auditModel.record({
    userId: user.id,
    action: "OTP_RESEND",
    metadata: { purpose },
    ipAddress,
    userAgent,
  });
  return { message: "A new code has been issued (see server console — DEV/MOCK)." };
}

// ---------- Change PIN (while logged in) ----------

// Requires the CURRENT PIN (proof you are at the device), then swaps the hash.
// Unlike the forgot flow, sessions survive — the user is already authenticated.
export async function changePin({ userId, currentPin, newPin, ipAddress, userAgent }) {
  const user = await userModel.findByIdWithPin(userId);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  const ok = await verifyPin(user.pin_hash, currentPin);
  if (!ok) throw new ApiError(401, "Current PIN is incorrect", "INVALID_PIN");

  if (currentPin === newPin) {
    throw new ApiError(400, "New PIN must be different from your current PIN", "PIN_UNCHANGED");
  }

  const pinHash = await hashPin(newPin);
  await userModel.updatePinHash(user.id, pinHash);

  await auditModel.record({
    userId: user.id,
    action: "PIN_CHANGED",
    entityType: "USER",
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  return { message: "PIN changed successfully." };
}