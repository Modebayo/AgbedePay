// Validation schemas for the Ride-Hailing endpoints.
// Rule names come from validators/rules.js.

export const quoteSchema = {
  tier: ["required", "string", ["enum", ["ECONOMY", "COMFORT", "BARGAIN"]]],
  passengers: ["required", "int", ["min", 1], ["max", 6]],
  pickup: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  dropoff: ["required", "string", ["minLen", 3], ["maxLen", 180]],
};

export const createBookingSchema = {
  tier: ["required", "string", ["enum", ["ECONOMY", "COMFORT", "BARGAIN"]]],
  passengers: ["required", "int", ["min", 1], ["max", 6]],
  pickup: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  pickupContact: ["required", "string", "phone"],
  dropoff: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  tipMinor: ["optional", "int", ["min", 0], ["max", 200000]],
  bargainOfferMinor: ["optional", "int", ["min", 100], ["max", 100000000]],
  pin: ["required", "string", "pin"],
};

export const advanceSchema = {
  action: ["required", "string", ["enum", ["ACCEPT", "ARRIVE", "START", "COMPLETE"]]],
};

export const shareSchema = {
  contact: ["optional", "string", "phone"],
};

export const rateSchema = {
  rating: ["required", "int", ["min", 1], ["max", 5]],
  tags: ["optional", "string", ["maxLen", 150]],
};

export const issueSchema = {
  issueType: ["required", "string", ["enum", ["ITEM_LEFT_IN_CAR", "INCORRECT_FARE", "DRIVER_CANCELLED", "UNPROFESSIONAL", "LONG_ROUTE"]]],
  note: ["optional", "string", ["maxLen", 300]],
};

export const bookingIdParams = {
  id: ["required", "string", "uuid"],
};