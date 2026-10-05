// Validation schemas for bills payments (electricity, data, cable TV).

export const purchaseElectricitySchema = {
  disCo: ["required", "string", ["maxLen", 40]],
  meterNo: ["required", ["digits", 6, 20]],
  meterType: ["required", ["enum", ["PREPAID", "POSTPAID"]]],
  amountMinor: ["required", "int", ["min", 1], ["max", 1000000000]],
  phone: ["optional", "phone"],
  pin: ["required", "string", "pin"],
};

export const purchaseDataSchema = {
  network: ["required", ["enum", ["MTN", "GLO", "AIRTEL", "9MOBILE"]]],
  planId: ["required", "string", ["maxLen", 40]],
  phone: ["required", "phone"],
  pin: ["required", "string", "pin"],
};

export const purchaseCableSchema = {
  provider: ["required", ["enum", ["DSTV", "GOTV", "SHOWTIME"]]],
  decoderNo: ["required", ["digits", 6, 16]],
  planId: ["required", "string", ["maxLen", 40]],
  phone: ["optional", "phone"],
  pin: ["required", "string", "pin"],
};

// Account lookup — no plan, no PIN, just who owns this decoder.
export const cableLookupSchema = {
  provider: ["required", ["enum", ["DSTV", "GOTV", "SHOWTIME"]]],
  decoderNo: ["required", ["digits", 6, 16]],
};