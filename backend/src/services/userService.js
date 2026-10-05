// user service — business rules about users, above the raw SQL.
// Controllers stay thin; anything that is "deciding" belongs here.

import * as userModel from "../models/users.js";
import * as walletModel from "../models/wallets.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { buildKycView } from "./kycService.js";
import { persistAvatar, deleteAvatar } from "../middleware/uploadAvatar.js";

// Helper shared by both profile lookups: shape a user+wallet for the API.
function buildProfile(user, wallet) {
  return {
    id: user.id,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    status: user.status,
    isVerified: user.is_verified,
    referralCode: user.referral_code,
    loginOtpEnabled: user.login_otp_enabled,
    securityAlertEnabled: user.security_alert_enabled,
    // A same-origin API path, not a public CDN URL and not a filesystem path.
    // The client can use it directly as an <img src>; the route checks the
    // session, so the bytes are not world-readable the way an express.static
    // hit on frontend/ would be.
    avatarUrl: user.avatar_filename ? "/api/users/avatar" : null,
    avatarUpdatedAt: user.avatar_updated_at ?? null,
    createdAt: user.created_at,
    wallet: wallet
      ? {
          id: wallet.id,
          currency: wallet.currency,
          balanceMinor: wallet.balance_minor,
          balanceNgn: formatNaira(wallet.balance_minor),
          status: wallet.status,
        }
      : null,
  };
}

// Business rule: a "public profile" is user + wallet, with money formatted for
// display and NEVER the pin hash.
export async function getPublicProfile(phone) {
  const user = await userModel.findByPhone(phone);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  const wallet = await walletModel.findByUserId(user.id);
  return buildProfile(user, wallet);
}

// Same profile, but for the authenticated user (ownership comes from the session).
export async function getProfileById(userId) {
  const user = await userModel.findByUserId(userId);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  const wallet = await walletModel.findByUserId(userId);
  const profile = buildProfile(user, wallet);
  profile.kyc = await buildKycView(userId);
  return profile;
}

// ---- Avatar ----------------------------------------------------------------

/**
 * Stores a new profile picture and returns the updated profile.
 *
 * The order of operations here is deliberate, and it is the part that is easy to
 * get wrong:
 *
 *   1. Validate and write the new file to disk FIRST.
 *   2. Then point the row at it.
 *   3. Only then unlink the file it replaced.
 *
 * Reversing steps 1 and 3 (the tempting order) destroys the old picture before
 * the new one is known to be good, so any validation failure leaves the user
 * with neither a working avatar nor a recoverable one. Doing it this way, the
 * worst case is a stray orphan file on disk, which is harmless — never a user
 * whose picture vanished because a request failed halfway.
 *
 * @param {number} userId  from the session, never from the request body
 * @param {Express.Multer.File} file  already parsed by multer, not yet trusted
 */
export async function setProfilePicture(userId, file) {
  // persistAvatar sniffs the real bytes and writes the file. It throws for
  // anything that is not a genuine JPEG/PNG/WebP, and it generates its own
  // filename, so the client's filename never reaches the filesystem.
  const stored = await persistAvatar(file);

  const updated = await userModel.setAvatar(userId, stored);
  if (!updated) {
    // The row vanished between requireAuth and here (account deleted mid-flight).
    // The file we just wrote is now unreferenced, so remove it rather than leak
    // an orphan.
    await deleteAvatar(stored.filename);
    throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);
  }

  // Only now is the old file expendable, and only if it was a different file.
  if (updated.previousFilename && updated.previousFilename !== stored.filename) {
    await deleteAvatar(updated.previousFilename);
  }

  return getProfileById(userId);
}

/**
 * Removes the profile picture, if there is one.
 *
 * Clearing an avatar you never had is a no-op that succeeds, rather than a 404.
 * The user clicking "remove" wants the outcome "no picture", and that outcome is
 * already true; erroring would just make the button look broken.
 */
export async function removeProfilePicture(userId) {
  const cleared = await userModel.clearAvatar(userId);
  if (!cleared) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  // The row is already authoritative (filename is NULL), so the unlink is
  // best-effort cleanup and cannot fail the request.
  await deleteAvatar(cleared.previous_filename);

  return getProfileById(userId);
}