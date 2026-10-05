// Validation schemas for wallet endpoints (Phase 10).

export const fundWalletSchema = {
  // amount is in KOBO (minor units) and must be a whole integer > 0.
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000]],
};