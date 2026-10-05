// Validation schemas for airtime purchases.

export const purchaseAirtimeSchema = {
  network: ["required", ["enum", ["MTN", "GLO", "AIRTEL", "9MOBILE"]]],
  phone: ["required", "phone"],
  amountMinor: ["required", "int", ["min", 1], ["max", 1000000000]],
  pin: ["required", "string", "pin"],
};