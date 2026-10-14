-- 028_virtual_accounts.sql
-- A stable, per-user "dedicated" account number that money can be transferred
-- into. Generated server-side and persisted so the number never changes between
-- visits (the client used to derive it locally, which meant clearing storage or
-- switching devices produced a different number). The mock funding provider
-- treats a transfer to this account as a wallet credit.

CREATE TABLE virtual_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(12) NOT NULL UNIQUE,
  account_name   VARCHAR(120) NOT NULL,
  bank_name      VARCHAR(80) NOT NULL,
  provider       VARCHAR(40) NOT NULL DEFAULT 'mock',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_virtual_accounts_user_id ON virtual_accounts(user_id);
