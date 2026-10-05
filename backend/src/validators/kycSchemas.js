// Validation schemas for the KYC / bio-data endpoints.
// Identity numbers are validated by SHAPE here; the provider does the real check.

export const bioSchema = {
  fullName: ["required", "string", ["maxLen", 120]],
  dateOfBirth: ["optional", "date"],
  gender: ["optional", ["enum", ["M", "F", "OTHER"]]],
  email: ["optional", "email"],
  address: ["optional", "string", ["maxLen", 255]],
  city: ["optional", "string", ["maxLen", 80]],
  state: ["optional", "string", ["maxLen", 80]],
  occupation: ["optional", "string", ["maxLen", 120]],
  nextOfKinName: ["optional", "string", ["maxLen", 120]],
  nextOfKinPhone: ["optional", "string", ["maxLen", 20]],
  nextOfKinRelation: ["optional", ["enum", ["Spouse", "Parent", "Sibling", "Child", "Friend", "Other"]]],
};

export const verifyIdentitySchema = {
  identityType: ["required", ["enum", ["NIN", "BVN"]]],
  identityNumber: ["required", "digits11"],
  pin: ["required", "string", "pin"],
};