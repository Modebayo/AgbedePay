// Validation schemas for the Wealth endpoints.
// Rule names come from validators/rules.js.
//
// Money follows the project rule: amounts are INTEGER kobo (minor units),
// never floats. Units are INTEGER hundred-thousandths of one instrument unit
// (see models/wealthModel.js UNIT_SCALE) so fractional shares stay exact.

export const instrumentClassSchema = {
  class: ["optional", "string", ["enum", ["STOCK", "FUND", "PENSION", "BOND"]]],
};

// A buy can be sized two ways, and exactly one of them must be present:
//   amountMinor -> "spend this much"  (units are resolved at the live price)
//   unitsMinor  -> "buy exactly this many units"
// The service rejects a request carrying both or neither, because "spend ₦5,000
// or give me 3 units" is not a real instruction and guessing is how money
// goes to the wrong place.
export const buyOrderSchema = {
  instrumentId: ["required", "string", "uuid"],
  amountMinor: ["optional", "int", ["min", 100], ["max", 100000000000]],
  unitsMinor: ["optional", "int", ["min", 1], ["max", 1000000000000]],
  pin: ["required", "string", "pin"],
};

// A sell is always sized in units — you sell a quantity you hold, and letting
// the customer sell "₦5,000 worth" would mean silently picking a quantity for
// them at whatever the price happened to be.
export const sellOrderSchema = {
  holdingId: ["required", "string", "uuid"],
  unitsMinor: ["required", "int", ["min", 1], ["max", 1000000000000]],
  pin: ["required", "string", "pin"],
};

// Pagination + optional filters for Investment History.
// :id path params.
export const instrumentIdParams = {
  id: ["required", "string", "uuid"],
};

// ---- Retirement goals ----
//
// `currentAge` is optional and is IGNORED whenever the account has a date of
// birth on file: the DOB is the fact, the typed number is a guess, and the row
// stores whichever one we used. The service records which in `ageSource`.
//
// `targetAge` and `targetAmountMinor` are bounded here for a fast, friendly
// failure; the cross-field rules (target age above current age, target date in
// the future) need the calendar and therefore live in retirementService.
export const retirementGoalSchema = {
  name: ["required", "string", ["minLen", 1], ["maxLen", 120]],
  targetAge: ["required", "int", ["min", 19], ["max", 100]],
  currentAge: ["optional", "int", ["min", 18], ["max", 100]],
  targetAmountMinor: ["required", "int", ["min", 100000], ["max", 100000000000000]],
  currentAmountMinor: ["optional", "int", ["min", 0], ["max", 100000000000000]],
  monthlyContributionMinor: ["optional", "int", ["min", 0], ["max", 100000000000000]],
  targetDate: ["required", "date"],
};

// Every field optional — a PATCH only rewrites what it carries. An entirely
// empty patch is rejected in the service rather than here, because validate()
// has no rule for "at least one of these".
export const retirementGoalPatchSchema = {
  name: ["optional", "string", ["minLen", 1], ["maxLen", 120]],
  targetAge: ["optional", "int", ["min", 19], ["max", 100]],
  targetAmountMinor: ["optional", "int", ["min", 100000], ["max", 100000000000000]],
  currentAmountMinor: ["optional", "int", ["min", 0], ["max", 100000000000000]],
  monthlyContributionMinor: ["optional", "int", ["min", 0], ["max", 100000000000000]],
  targetDate: ["optional", "date"],
};

export const goalIdParams = {
  id: ["required", "string", "uuid"],
};
