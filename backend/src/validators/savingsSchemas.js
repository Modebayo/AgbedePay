// Validation schemas for the Phase 8 savings endpoints.
// Rule names come from validators/rules.js.
//
// Money follows the project rule: amounts are INTEGER kobo (minor units),
// never floats.

export const createGoalSchema = {
  name: ["required", "string", ["maxLen", 120]],
  // target amount in kobo; min ₦1, max ₦1,000,000,000
  targetAmountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  targetDate: ["optional", "string", "date"],
};

export const depositSchema = {
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  pin: ["required", "string", "pin"],
};

// Pulling money back OUT of a goal — same shape as a deposit (PIN + kobo).
export const withdrawSchema = {
  amountMinor: ["required", "int", ["min", 1], ["max", 100000000000]],
  pin: ["required", "string", "pin"],
};

// :id path params — goal ids are UUIDs.
export const goalIdParams = {
  id: ["required", "string", "uuid"],
};