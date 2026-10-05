// Validation schemas for betting account top-ups.

const BETTING_PLATFORMS = ["BET9JA", "SPORTYBET", "1XBET", "MERRYBET", "BETKING"];

export const bettingLookupSchema = {
  platform: ["required", ["enum", BETTING_PLATFORMS]],
  customerId: ["required", "string", ["minLen", 2], ["maxLen", 40]],
};

export const bettingPurchaseSchema = {
  platform: ["required", ["enum", BETTING_PLATFORMS]],
  customerId: ["required", "string", ["minLen", 2], ["maxLen", 40]],
  amountMinor: ["required", "int", ["min", 1], ["max", 1000000000]],
  pin: ["required", "string", "pin"],
};