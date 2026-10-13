// Validation schemas for the cash-out endpoints.

export const addAccountSchema = {
  bankName: ["required", "string", ["maxLen", 80]],
  accountName: ["required", "string", ["minLen", 2], ["maxLen", 120]],
  // Nigerian account numbers are 10 digits (NUBAN). Length is re-checked
  // exactly in the service (the digits rule only guarantees "at least n").
  accountNumber: ["required", "digits", 10],
  // PAYOUT = the user's own bank; AGENT = a cash-agent pickup destination.
  kind: ["optional", ["enum", ["PAYOUT", "AGENT"]]],
};

export const accountIdParams = {
  id: ["required", "string", "uuid"],
};

export const withdrawSchema = {
  accountId: ["required", "uuid"],
  // amount is in KOBO (minor units), whole integer > 0.
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000]],
  pin: ["required", "string", "pin"],
};