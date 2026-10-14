-- 003_wallets.sql
-- Where money actually lives. One wallet per user.

CREATE TABLE wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  currency      CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0), -- kobo; never negative
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups by owner (the UNIQUE on user_id already creates an index too).
CREATE INDEX idx_wallets_user_id ON wallets(user_id);

CREATE TRIGGER wallets_set_updated_at
BEFORE UPDATE ON wallets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();