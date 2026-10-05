// MOCK identity/verification provider — DEVELOPMENT ONLY.
// Real NIN/BVN checks call NIMC / a BVN gateway. This mock accepts any
// well-formed 11-digit number and returns a stable, clearly-labelled result so
// the FULL flow (submit -> provider -> verify -> stored) is testable without
// a real gateway. It never stores the raw number.

import crypto from "node:crypto";

// Deterministic pseudo-name from the number so re-verification is stable.
const MOCK_NAMES = [
  "Fatima Adeyemi",
  "Chinedu Okafor",
  "Ngozi Eze",
  "Musa Ibrahim",
  "Yetunde Bakare",
  "Emeka Nwosu",
];

function stableName(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  return MOCK_NAMES[h[0] % MOCK_NAMES.length];
}

export async function verifyIdentity({ type, number }) {
  const name = stableName(number);
  return {
    verified: true,
    identityType: type,
    name,
    phoneMatch: false, // gateways return this; mock always false
    reference: `MOCK-${type}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    provider: "mock-identity",
    devOnly: true,
  };
}