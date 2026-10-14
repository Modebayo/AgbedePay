// Validation schemas for the admin console endpoints.
// Rule names come from validators/rules.js.

export const adminIdParams = {
  id: ["required", "string", "uuid"],
};

export const driverStatusSchema = {
  status: ["required", ["enum", ["ACTIVE", "SUSPENDED", "PENDING"]]],
};

export const cargoQuoteSchema = {
  quotedAmountMinor: ["optional", "int", ["min", 100]],
  adminNote: ["optional", "string", ["maxLen", 500]],
  status: ["optional", ["enum", ["REQUESTED", "QUOTED", "ACCEPTED", "CLOSED", "CANCELLED"]]],
};

export const supportReplySchema = {
  reply: ["required", "string", ["minLen", 1], ["maxLen", 1000]],
  status: ["optional", ["enum", ["OPEN", "IN_PROGRESS", "RESOLVED"]]],
};

export const reconcileParams = {
  reference: ["required", "string", ["minLen", 3], ["maxLen", 64]],
};
