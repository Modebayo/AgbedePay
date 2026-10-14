-- 006_otp_codes.sql
-- One-time passwords for registration and "forgot PIN".
-- We store ONLY the SHA-256 hash of the code, never the code itself.

CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(20) NOT NULL,
  purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('REGISTRATION', 'FORGOT_PIN')),
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,     -- max attempts enforced in application logic
  consumed_at TIMESTAMPTZ,                -- set when successfully used (one-time only)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Find the latest code for a phone & purpose quickly: WHERE phone=$1 ORDER BY created_at DESC
CREATE INDEX idx_otp_codes_phone_created ON otp_codes(phone, created_at DESC);