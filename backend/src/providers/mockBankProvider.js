// MOCK account-name resolver & bank directory — DEVELOPMENT ONLY.
//
// Real OPay/transfer flows call the NUBAN name-enquiry API for a bank before
// letting you send. This mock produces a stable, plausible name from the
// account number so the "who am I sending to?" preview works offline.
// Swap `resolveAccountName` for the real provider call when one is wired up.

import { ApiError } from "../utils/errors.js";

export const BANKS = [
  "Opay",
  "PalmPay",
  "Moniepoint",
  "Kuda",
  "GTBank",
  "Access Bank",
  "First Bank",
  "Zenith Bank",
  "UBA",
  "Stanbic IBTC",
  "Union Bank",
  "Fidelity Bank",
];

const FIRST = [
  "Chiamaka", "Emeka", "Aisha", "Tunde", "Ngozi", "Ibrahim", "Folake",
  "Chinedu", "Fatima", "Kelechi", "Segun", "Halima", "Adaora", "Musa",
  "Yemi", "Chioma", "Bode", "Zainab", "Ifeanyi", "Rashidat",
];

const LAST = [
  "Okafor", "Adeyemi", "Bello", "Nwosu", "Eze", "Olawale", "Abubakar",
  "Okonkwo", "Balogun", "Ibrahim", "Adeleke", "Uche", "Salami", "Aliyu",
  "Fashola", "Onyeka", "Jibril", "Afolabi", "Okoye", "Bakare",
];

export function normalizeBank(bank) {
  return bank?.trim() ?? "";
}

export function assertSupportedBank(bank) {
  if (!BANKS.includes(bank)) {
    throw new ApiError(400, `Unsupported bank — supported: ${BANKS.join(", ")}`, "INVALID_BANK");
  }
  return bank;
}

// Deterministic name enquiry: same account number always resolves to the same
// name (the way a real provider returns a stable account record).
export function resolveAccountName(bank, accountNumber) {
  assertSupportedBank(bank);
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError(400, "Account numbers are exactly 10 digits", "VALIDATION");
  }
  if (/^(\d)\1{9}$/.test(accountNumber)) {
    throw new ApiError(400, "That account number looks invalid — check and try again", "INVALID_ACCOUNT");
  }
  let h = 0;
  for (const ch of accountNumber) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const first = FIRST[h % FIRST.length];
  const last = LAST[(h >>> 3) % LAST.length];
  return `${first} ${last}`;
}