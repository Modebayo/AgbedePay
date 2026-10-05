// kyc service — bio-data (KYC) capture and identity verification.
// Business rules here: (1) bio data must be complete before identity verify,
// (2) NIN/BVN numbers are NEVER stored — only their SHA-256 hash, and
// (3) the "level" shown is always derived from stored facts, never from the
// client.

import * as userModel from "../models/users.js";
import * as walletModel from "../models/wallets.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import * as limitsService from "./limitsService.js";
import { verifyIdentity } from "../providers/mockIdentityProvider.js";
import { ApiError } from "../utils/errors.js";
import { verifyPin } from "../utils/crypto.js";
import { identityNumberHash } from "./purchaseService.js";

const BIO_FIELDS = [
  "dateOfBirth",
  "gender",
  "address",
  "city",
  "state",
  "occupation",
  "nextOfKinName",
  "nextOfKinPhone",
  "nextOfKinRelation",
];

function isBioComplete(bio) {
  return BIO_FIELDS.every((f) => {
    const v = bio?.[f];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

// Answer "how good is this user's profile" from the database record only.
function deriveKyc(row) {
  const bio = {
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    gender: row.gender ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    occupation: row.occupation ?? null,
    nextOfKinName: row.next_of_kin_name ?? null,
    nextOfKinPhone: row.next_of_kin_phone ?? null,
    nextOfKinRelation: row.next_of_kin_relation ?? null,
  };

  const identityVerified = row.verification_level === "IDENTITY_VERIFIED";
  const bioComplete = isBioComplete(bio);
  const level = identityVerified
    ? "IDENTITY_VERIFIED"
    : bioComplete
      ? "BASIC"
      : "NONE";

  return {
    level,
    bioComplete,
    identityVerified,
    identityType: row.identity_type ?? null,
    verifiedAt: row.verified_at ?? null,
    steps: {
      fullName: Boolean(bio.fullName),
      dateOfBirth: Boolean(bio.dateOfBirth),
      gender: Boolean(bio.gender),
      address: Boolean(bio.address),
      city: Boolean(bio.city),
      state: Boolean(bio.state),
      occupation: Boolean(bio.occupation),
      nextOfKin: Boolean(bio.nextOfKinName && bio.nextOfKinPhone && bio.nextOfKinRelation),
    },
    bio,
  };
}

export async function getKyc(userId) {
  const row = await userModel.findUserWithKyc(userId);
  if (!row) throw new ApiError(404, "User not found", "NOT_FOUND");
  const kyc = deriveKyc(row);
  // The limits come from the SAME stored level the UI shows — never a client value.
  const wallet = await walletModel.findByUserId(userId);
  const { limits } = await limitsService.getLimits(userId, wallet?.id ?? null);
  return { kyc: { ...kyc, limits } };
}

// The same view, but never throws — used to attach kyc to a profile response.
export async function buildKycView(userId) {
  const row = await userModel.findUserWithKyc(userId);
  return row ? deriveKyc(row) : null;
}

export async function getLimits(userId) {
  const wallet = await walletModel.findByUserId(userId);
  return limitsService.getLimits(userId, wallet?.id ?? null);
}

export async function updateBioData(userId, fields, ctx = {}) {
  const updated = await userModel.updateBio(userId, {
    fullName: fields.fullName,
    email: fields.email,
    dateOfBirth: fields.dateOfBirth,
    gender: fields.gender,
    address: fields.address,
    city: fields.city,
    state: fields.state,
    occupation: fields.occupation,
    nextOfKinName: fields.nextOfKinName,
    nextOfKinPhone: fields.nextOfKinPhone,
    nextOfKinRelation: fields.nextOfKinRelation,
  });
  if (!updated) throw new ApiError(404, "User not found", "NOT_FOUND");

  await auditModel.record({
    userId,
    action: "KYC_BIO_UPDATED",
    entityType: "USER",
    entityId: userId,
    metadata: { fields: ["fullName", "email", ...BIO_FIELDS].filter((f) => fields[f] !== undefined) },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return getKyc(userId);
}

export async function verifyIdentityNumber({
  userId,
  identityType,
  identityNumber,
  pin,
  ipAddress,
  userAgent,
}) {
  const user = await userModel.findByIdWithPin(userId);
  if (!user) throw new ApiError(404, "User not found", "NOT_FOUND");

  const userRow = await userModel.findUserWithKyc(userId);
  const kyc = deriveKyc(userRow);
  if (!kyc.bioComplete) {
    throw new ApiError(
      400,
      "Complete your bio data (date of birth, address, city, state) before verifying your identity",
      "BIO_INCOMPLETE"
    );
  }

  const pinOk = await verifyPin(user.pin_hash, pin);
  if (!pinOk) throw new ApiError(401, "Invalid PIN", "INVALID_PIN");

  const result = await verifyIdentity({ type: identityType, number: identityNumber });

  await userModel.updateIdentity(userId, {
    identityType,
    identityHash: identityNumberHash(identityNumber),
  });

  await auditModel.record({
    userId,
    action: "KYC_IDENTITY_VERIFIED",
    entityType: "USER",
    entityId: userId,
    metadata: { identityType, reference: result.reference },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "KYC",
    link: linkForType("KYC"),
    title: "Identity verified",
    body: `Your account is now ${identityType}-verified — full withdrawal limits unlocked.`,
  });

  const fresh = await getKyc(userId);
  return { verification: result, kyc: fresh.kyc };
}