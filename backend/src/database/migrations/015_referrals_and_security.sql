-- 015_referrals_and_security.sql
-- Referral programmes + optional login security code (OTP).

-- 1) Every user gets a unique referral code; backfill existing rows now.
ALTER TABLE users
  ADD COLUMN referral_code    VARCHAR(12) UNIQUE,
  ADD COLUMN login_otp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id FROM users WHERE referral_code IS NULL LOOP
    UPDATE users
       SET referral_code = upper(substr(md5(u.id::text || clock_timestamp()::text), 1, 8))
     WHERE id = u.id;
  END LOOP;
END $$;

-- 2) Referral relationships. A referred user may only be claimed once; the
--    UNIQUE(referred_id) is what makes the bonus credit exactly-once.
CREATE TABLE referrals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  referred_id UUID NOT NULL UNIQUE REFERENCES users(id),
  status      VARCHAR(16) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'CREDITED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  credited_at TIMESTAMPTZ
);