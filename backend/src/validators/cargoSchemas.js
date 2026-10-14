// Validation schemas for the Agbede Cargo quotation endpoints.
// Rule names come from validators/rules.js.

export const cargoRequestSchema = {
  pickupAddress: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  dropoffAddress: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  cargoType: ["required", "string", ["minLen", 2], ["maxLen", 60]],
  approxWeightKg: ["optional", ["min", 0.1], ["max", 100000]],
  dimensions: ["optional", "string", ["maxLen", 80]],
  vehicleRequirements: ["optional", "string", ["maxLen", 120]],
  collectionDate: ["optional", "date"],
  contactName: ["required", "string", ["minLen", 2], ["maxLen", 120]],
  contactPhone: ["required", "string", "phone"],
  notes: ["optional", "string", ["maxLen", 500]],
};

export const cargoIdParams = {
  id: ["required", "string", "uuid"],
};
