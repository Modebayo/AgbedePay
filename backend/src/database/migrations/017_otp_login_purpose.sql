-- 017_otp_login_purpose.sql
-- Allow OTP codes to be issued for the LOGIN security-code purpose (added with
-- the login two-factor feature). Previously only REGISTRATION and FORGOT_PIN.

ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;

ALTER TABLE otp_codes
  ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('REGISTRATION', 'FORGOT_PIN', 'LOGIN'));