// virtual account service — hands each user a stable "dedicated account" to
// receive transfers into. Created lazily on first request and persisted, so the
// number is the same on every device (unlike a client-derived value).

import * as virtualAccountModel from "../models/virtualAccounts.js";
import * as userModel from "../models/users.js";
import { ApiError } from "../utils/errors.js";

const BANK_NAME = "Wema Bank";

// FNV-1a + xorshift: deterministic, so an account number is derived from the
// user id rather than drawn at random (a re-run yields the same candidate).
function candidateNumber(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let out = "9";
  for (let i = 0; i < 9; i += 1) {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    out += String(h % 10);
  }
  return out;
}

function toApi(row) {
  return {
    accountNumber: row.account_number,
    accountName: row.account_name,
    bankName: row.bank_name,
    provider: row.provider,
  };
}

export async function getVirtualAccount(userId) {
  const existing = await virtualAccountModel.findByUserId(userId);
  if (existing) return toApi(existing);

  const user = await userModel.findByUserId(userId);
  const accountName = (user?.full_name || "AGBEDEPAY USER").toUpperCase();

  // A cross-user account-number collision is vanishingly rare; if it happens we
  // just try the next deterministic candidate.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const created = await virtualAccountModel.create({
        userId,
        accountNumber: candidateNumber(`${userId}|va|${attempt}`),
        accountName,
        bankName: BANK_NAME,
      });
      return toApi(created);
    } catch (err) {
      if (err.code === "23505") {
        const again = await virtualAccountModel.findByUserId(userId);
        if (again) return toApi(again);
        continue;
      }
      throw err;
    }
  }

  throw new ApiError(500, "Could not allocate a funding account right now", "VIRTUAL_ACCOUNT");
}
