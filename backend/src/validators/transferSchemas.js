// Validation schemas for the Phase 7 transaction endpoints.
// Rule names come from validators/rules.js.

// A wallet transfer identifies the recipient by phone OR by their 10-digit
// AgbedePay account number. Exactly one is required; the service enforces that
// (the rule engine has no "exactly one of" primitive).
export const sendMoneySchema = {
  recipientPhone: ["optional", "string", "phone"],
  recipientAccount: ["optional", "string", "bankAccount"],
  // amount is in KOBO (minor units) and must be a whole integer > 0.
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  narration: ["optional", "string", ["maxLen", 255]],
  pin: ["required", "string", "pin"],
};

// Reverse lookup for the AgbedePay recipient preview: resolve a name from an
// account number or a phone number. Exactly one is required (service-enforced).
export const verifyAgbedeAccountSchema = {
  accountNumber: ["optional", "string", "bankAccount"],
  phone: ["optional", "string", "phone"],
};

export const verifyBankAccountSchema = {
  bankName: ["required", "string", ["maxLen", 80]],
  accountNumber: ["required", "string", "bankAccount"],
};

export const sendToBankSchema = {
  bankName: ["required", "string", ["maxLen", 80]],
  accountNumber: ["required", "string", "bankAccount"],
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  narration: ["optional", "string", ["maxLen", 255]],
  pin: ["required", "string", "pin"],
};

export const requestMoneySchema = {
  payerPhone: ["required", "string", "phone"],
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  note: ["optional", "string", ["maxLen", 255]],
};

export const payRequestSchema = {
  pin: ["required", "string", "pin"],
};

export const reverseSchema = {
  pin: ["required", "string", "pin"],
};

// :id path params — transaction ids are UUIDs.
export const transactionIdParams = {
  id: ["required", "string", "uuid"],
};

// /requests/:id — payment request ids are UUIDs too.
export const requestIdParams = {
  id: ["required", "string", "uuid"],
};