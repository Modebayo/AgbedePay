// user controller — the thin HTTP layer.
// Reads the request, calls a service/model, sends the response.
// No SQL here. No money math here. Just request ↔ response.

import { asyncHandler, ApiError, ErrorCodes } from "../utils/errors.js";
import * as userModel from "../models/users.js";
import {
  getPublicProfile,
  getProfileById,
  setProfilePicture,
  removeProfilePicture,
} from "../services/userService.js";
import { avatarUpload, resolveAvatarPath } from "../middleware/uploadAvatar.js";
import fs from "node:fs/promises";

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await userModel.findAll();
  res.json({ success: true, data: { count: users.length, users } });
});

export const getMe = asyncHandler(async (req, res) => {
  const profile = await getProfileById(req.user.id);
  res.json({ success: true, data: { profile } });
});

export const getUserByPhone = asyncHandler(async (req, res) => {
  const profile = await getPublicProfile(req.params.phone);
  res.json({ success: true, data: { profile } });
});

export const renameUser = asyncHandler(async (req, res) => {
  const user = await userModel.rename(req.params.phone, req.body.fullName);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);
  res.json({ success: true, data: { user } });
});

// ---- Avatar ----------------------------------------------------------------

/**
 * GET /api/users/avatar — streams the signed-in user's own picture.
 *
 * Note there is no :id or :filename parameter. That is the whole point: there is
 * no way to express "show me someone else's avatar" in this URL, so IDOR is not
 * possible by construction rather than by a check that could be forgotten later.
 * The user comes from the session, never from the request.
 */
export const getMyAvatar = asyncHandler(async (req, res) => {
  // findByUserId deliberately does not select pin_hash, and it does select
  // avatar_filename, so this read cannot leak anything else.
  const user = await userModel.findByUserId(req.user.id);
  if (!user) throw new ApiError(404, "User not found", ErrorCodes.NOT_FOUND);

  if (!user.avatar_filename) {
    throw new ApiError(404, "No profile picture set", ErrorCodes.NOT_FOUND);
  }

  // Defence in depth: even though avatar_filename is always a bare UUID we
  // wrote, resolveAvatarPath refuses anything that is not a plain filename
  // inside the avatar directory. A tampered database row therefore cannot make
  // this handler read an arbitrary file such as /etc/passwd.
  const full = resolveAvatarPath(user.avatar_filename);
  if (!full) {
    throw new ApiError(404, "No profile picture set", ErrorCodes.NOT_FOUND);
  }

  let bytes;
  try {
    bytes = await fs.readFile(full);
  } catch {
    // The row references a file that is not there — a manual deletion, or a
    // restored database paired with a wiped storage volume. Reported as 404 so
    // the client falls back to initials rather than showing a broken image.
    throw new ApiError(404, "No profile picture set", ErrorCodes.NOT_FOUND);
  }

  // The stored MIME is used, not one derived from the request. It came from our
  // own byte-sniffing at upload time, so it cannot be "text/html".
  res.setHeader("Content-Type", user.avatar_mime || "application/octet-stream");
  res.setHeader("Content-Length", bytes.length);

  // Private: this is a personal photo and must not be written to a shared cache
  // or readable by a proxy. The filename is UUID-based, so it is unguessable,
  // but the avatar is also the same for every request from that user — hence
  // "no-store" rather than a weak max-age.
  res.setHeader("Cache-Control", "private, no-store");

  // Belt and braces alongside the Content-Type. If an attacker somehow got an
  // SVG or HTML named .jpg past the sniffer, nosniff stops a browser from
  // reinterpreting the response as a document. X-Content-Type-Options is
  // normally set by helmet globally, but this response is not HTML so it is set
  // explicitly where it matters.
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Content-Disposition: inline without a filename stops the browser from
  // treating the response as a download and from echoing the internal name.
  res.setHeader("Content-Disposition", "inline");

  res.status(200).end(bytes);
});

/**
 * POST /api/users/avatar — accepts the upload, validates the bytes, stores the
 * file, and returns the updated profile.
 */
export const uploadAvatar = asyncHandler(async (req, res) => {
  // The multer middleware runs inline as a route-level handler. Wrapping it in
  // asyncHandler means a multer failure (file too large, wrong field name, too
  // many files) still reaches the central errorHandler and is returned as a
  // normal { success: false } JSON envelope instead of a raw 500.
  await avatarUpload(req, res, async () => {
    const profile = await setProfilePicture(req.user.id, req.file);
    res.json({ success: true, data: { profile } });
  });
});

/** DELETE /api/users/avatar — removes the picture. */
export const removeAvatar = asyncHandler(async (req, res) => {
  const profile = await removeProfilePicture(req.user.id);
  res.json({ success: true, data: { profile } });
});