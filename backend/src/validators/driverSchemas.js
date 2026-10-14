// Validation schemas for the Agbede Driver endpoints.
// Rule names come from validators/rules.js.

const KIND = ["RIDE", "DISPATCH"];

// Self-service driver application. Plate rules vary by state, so we only
// constrain length/format loosely rather than pretend to validate a plate.
export const driverApplySchema = {
  vehicleType: ["required", ["enum", ["CAR", "VAN", "BIKE"]]],
  carMakeModel: ["required", "string", ["minLen", 2], ["maxLen", 80]],
  carColor: ["required", "string", ["minLen", 2], ["maxLen", 40]],
  plateNumber: ["required", "string", ["minLen", 3], ["maxLen", 20]],
};

export const availabilitySchema = {  isOnline: ["required", "bool"],
  lat: ["optional", ["min", -90], ["max", 90]],
  lng: ["optional", ["min", -180], ["max", 180]],
};

export const kindIdParams = {
  kind: ["required", "string", ["enum", KIND]],
  id: ["required", "string", "uuid"],
};

export const tripParams = {
  kind: ["required", "string", ["enum", KIND]],
  id: ["required", "string", "uuid"],
  action: [
    "required",
    "string",
    ["enum", ["arrived", "start", "complete", "pickup", "transit", "deliver"]],
  ],
};

export const completeSchema = {
  otpCode: ["optional", "code"],
};
