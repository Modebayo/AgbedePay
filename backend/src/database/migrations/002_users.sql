-- 002_users.sql
-- The account. One row per human. This is WHO someone is.

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   VARCHAR(120) NOT NULL,
  phone       VARCHAR(20)  NOT NULL UNIQUE,   -- login identity; never duplicate
  email       VARCHAR(255) UNIQUE,            -- optional, but unique when set
  pin_hash    TEXT NOT NULL,                  -- Argon2id hash, NEVER plaintext
  status      VARCHAR(20) NOT NULL DEFAULT 'PENDING_VERIFICATION'
              CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE, -- true only after OTP verification
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at current automatically.
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();