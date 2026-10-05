// Validation schemas for the Logistics & Dispatch endpoints.
// Rule names come from validators/rules.js.

export const quoteSchema = {
  serviceType: ["required", "string", ["enum", ["PACKAGE", "ERRAND"]]],
  itemType: ["required", "string", ["enum", ["DOCUMENT", "SMALL", "MEDIUM", "FRAGILE", "HEAVY"]]],
  vehicleType: ["required", "string", ["enum", ["BIKE", "CAR", "VAN"]]],
  pickup: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  dropoff: ["required", "string", ["minLen", 3], ["maxLen", 180]],
};

export const createBookingSchema = {
  serviceType: ["required", "string", ["enum", ["PACKAGE", "ERRAND"]]],
  itemType: ["required", "string", ["enum", ["DOCUMENT", "SMALL", "MEDIUM", "FRAGILE", "HEAVY"]]],
  vehicleType: ["required", "string", ["enum", ["BIKE", "CAR", "VAN"]]],
  pickup: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  pickupContact: ["required", "string", "phone"],
  dropoff: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  dropoffContact: ["required", "string", "phone"],
  pin: ["required", "string", "pin"],
};

export const advanceSchema = {
  action: ["required", "string", ["enum", ["ASSIGN", "PICKUP", "TRANSIT", "DELIVER"]]],
  otp: ["optional", "string", ["digits", 4, 4]],
};

export const rateSchema = {
  rating: ["required", "int", ["min", 1], ["max", 5]],
  tags: ["optional", "string", ["maxLen", 150]],
};

export const issueSchema = {
  issueType: ["required", "string", ["enum", ["ITEM_DAMAGED", "RIDER_LATE", "WRONG_ADDRESS", "ITEM_LOST", "DELIVERY_ISSUE"]]],
  note: ["optional", "string", ["maxLen", 300]],
};

export const bookingIdParams = {
  id: ["required", "string", "uuid"],
};