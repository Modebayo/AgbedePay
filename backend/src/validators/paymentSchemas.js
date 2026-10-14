// Validation schemas for the hosted-checkout payment endpoints.
// Money is integer kobo (minor units), matching the rest of the app.

export const paymentInitiateSchema = {
  amountMinor: ["required", "int", ["min", 100], ["max", 100000000]],
};

export const paymentReferenceSchema = {
  reference: ["required", "string", ["minLen", 6], ["maxLen", 64]],
};
