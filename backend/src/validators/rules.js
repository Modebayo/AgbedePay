// Reusable validation RULES. Each returns true (OK) or false (failed).
// A rule may take an argument: use ["maxLen", 120] in a schema.

const str = (v) => typeof v === "string";

export const rules = {
  required: {
    run: (v) => v !== undefined && v !== null && String(v).trim() !== "",
  },
  string: {
    run: (v) => str(v),
  },
  // Nigerian mobile numbers: 11 digits starting 07 / 08 / 09
  phone: {
    run: (v) => str(v) && /^0[789][0-9]{9}$/.test(v),
  },
  // Whole amount in minor units (kobo) — never a float
  int: {
    run: (v) => Number.isInteger(v),
  },
  min: {
    args: true,
    run: (v, [n]) => typeof v === "number" && v >= n,
  },
  max: {
    args: true,
    run: (v, [n]) => typeof v === "number" && v <= n,
  },
  minLen: {
    args: true,
    run: (v, [n]) => str(v) && v.length >= n,
  },
  maxLen: {
    args: true,
    run: (v, [n]) => str(v) && v.length <= n,
  },
  uuid: {
    run: (v) =>
      str(v) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  },
  email: {
    run: (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  },
  // 6-digit PIN that isn't trivially guessable (no 000000, 111111, 123456…).
  pin: {
    run: (v) => {
      if (typeof v !== "string" || !/^\d{6}$/.test(v)) return false;
      if (/(.)\1{5}/.test(v)) return false; // all digits identical
      if ("0123456789".includes(v) || "9876543210".includes(v)) return false; // runs
      return true;
    },
  },
  // 6-digit OTP verification code.
  code: {
    run: (v) => typeof v === "string" && /^\d{6}$/.test(v),
  },
  // 11-digit Nigerian identity numbers (NIN, BVN).
  digits11: {
    run: (v) => typeof v === "string" && /^\d{11}$/.test(v),
  },
  // Any all-digit string within a length range, e.g. electricity meter numbers.
  digits: {
    args: true,
    run: (v, [min = 1, max = 100]) =>
      typeof v === "string" && /^\d+$/.test(v) && v.length >= min && v.length <= max,
  },
  // Value must be one of a fixed list, e.g. ["enum", ["MTN","GLO","AIRTEL","9MOBILE"]].
  enum: {
    args: true,
    run: (v, [allowed]) => Array.isArray(allowed) && allowed.includes(v),
  },
  purpose: {
    run: (v) => v === "REGISTRATION" || v === "FORGOT_PIN" || v === "LOGIN",
  },
  // Strict boolean (sent as JSON true/false, never truthy strings).
  bool: {
    run: (v) => typeof v === "boolean",
  },
  // Nigerian bank account NUBAN — exactly 10 digits.
  bankAccount: {
    run: (v) => typeof v === "string" && /^\d{10}$/.test(v),
  },
  // ISO date yyyy-mm-dd that also really is a date (2026-02-31 would fail).
  date: {
    run: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  },
};