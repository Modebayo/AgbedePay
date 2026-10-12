// Validation schemas for every auth endpoint. Rule names come from
// validators/rules.js. These run BEFORE any service logic.

export const registerSchema = {
  fullName: ["required", "string", ["minLen", 2], ["maxLen", 120]],
  phone: ["required", "string", "phone"],
  email: ["optional", "email", ["maxLen", 255]],
  pin: ["required", "string", "pin"],
  confirmPin: ["required", "string", "pin"],
  referralCode: ["optional", "string", ["minLen", 6], ["maxLen", 12]],
};

export const loginSchema = {
  phone: ["required", "string", "phone"],
  pin: ["required", "string", "pin"],
};

export const loginOtpSchema = {
  phone: ["required", "string", "phone"],
  code: ["required", "string", "code"],
};

export const loginOtpToggleSchema = {
  enabled: ["required", "bool"],
};

// Same shape for the "new device signed in" alert preference.
export const securityAlertToggleSchema = {
  enabled: ["required", "bool"],
};

export const forgotPinSchema = {
  phone: ["required", "string", "phone"],
};

export const resetPinSchema = {
  phone: ["required", "string", "phone"],
  code: ["required", "string", "code"],
  pin: ["required", "string", "pin"],
  confirmPin: ["required", "string", "pin"],
};

export const changePinSchema = {
  currentPin: ["required", "string", "pin"],
  newPin: ["required", "string", "pin"],
};

// :id path param for the session-management endpoints.
export const sessionIdParams = {
  id: ["required", "string", "uuid"],
};