// /api/auth/* routes. Order of middleware per route:
//   rate limiter → input validation → controller (which calls the service)

import { Router } from "express";
import { validate } from "../validators/validate.js";
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  loginOtpSchema,
  loginOtpToggleSchema,
  forgotPinSchema,
  resetPinSchema,
  changePinSchema,
  sessionIdParams,
  securityAlertToggleSchema,
} from "../validators/authSchemas.js";
import * as authController from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { otpLimiter, loginLimiter, registerLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.post("/register", registerLimiter, validate(registerSchema), authController.register);
router.post("/verify-otp", otpLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post("/resend-otp", otpLimiter, validate(resendOtpSchema), authController.resendOtp);
router.post("/login", loginLimiter, validate(loginSchema), authController.login);
router.post("/login/otp", otpLimiter, validate(loginOtpSchema), authController.loginOtp);
router.post("/login-otp", requireAuth, validate(loginOtpToggleSchema), authController.loginOtpToggle);
router.post("/security-alert", requireAuth, validate(securityAlertToggleSchema), authController.securityAlertToggle);
router.post("/logout", requireAuth, authController.logout);
router.get("/sessions", requireAuth, authController.listSessions);
router.post("/sessions/:id/revoke", requireAuth, validate(sessionIdParams, "params"), authController.revokeSession);
router.post("/forgot-pin", otpLimiter, validate(forgotPinSchema), authController.forgotPin);
router.post("/reset-pin", otpLimiter, validate(resetPinSchema), authController.resetPin);
router.post("/pin", requireAuth, validate(changePinSchema), authController.changePin);

export default router;