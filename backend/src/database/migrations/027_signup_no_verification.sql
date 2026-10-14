-- 027_signup_no_verification.sql
-- Account creation no longer requires an OTP/verification step. New accounts
-- are active and verified the moment they are created. Retire the REGISTRATION
-- OTP purpose (only FORGOT_PIN and LOGIN issue codes now).

-- Any account still waiting on verification becomes active + verified.
UPDATE users
   SET is_verified = true,
       status = 'ACTIVE'
 WHERE status = 'PENDING_VERIFICATION';

-- New accounts are ACTIVE + verified from the moment they are created.
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE users ALTER COLUMN is_verified SET DEFAULT true;

-- PENDING_VERIFICATION is no longer a reachable state.
ALTER TABLE users DROP CONSTRAINT users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'));

-- Registration no longer issues OTPs; only FORGOT_PIN and LOGIN do.
-- Purge any leftover REGISTRATION codes first so the new CHECK validates.
DELETE FROM otp_codes WHERE purpose = 'REGISTRATION';

ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;

ALTER TABLE otp_codes
  ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('FORGOT_PIN', 'LOGIN'));
