-- 010_kyc.sql
-- KYC / bio data + identity verification, stored on each user.
-- identity numbers are NEVER stored plaintext — only a SHA-256 hash.
-- Bio data (date of birth, gender, address) is normal PII and kept as-is.

ALTER TABLE users
  ADD COLUMN date_of_birth      DATE,
  ADD COLUMN gender             VARCHAR(10) CHECK (gender IN ('M', 'F', 'OTHER')),
  ADD COLUMN address            VARCHAR(255),
  ADD COLUMN city               VARCHAR(80),
  ADD COLUMN state              VARCHAR(80),
  ADD COLUMN identity_type      VARCHAR(10) CHECK (identity_type IN ('NIN', 'BVN')),
  ADD COLUMN identity_hash      TEXT, -- SHA-256 of NIN/BVN, never the number itself
  ADD COLUMN verification_level VARCHAR(24) NOT NULL DEFAULT 'NONE'
                                CHECK (verification_level IN ('NONE', 'BASIC', 'IDENTITY_VERIFIED')),
  ADD COLUMN verified_at        TIMESTAMPTZ;