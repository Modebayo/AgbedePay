-- 004_transactions.sql
-- The immutable record of every money movement.
-- We NEVER edit SUCCESS rows. Corrections are new REVERSAL rows.

CREATE TABLE transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          VARCHAR(64) NOT NULL UNIQUE,        -- human-readable, e.g. TXN-...
  idempotency_key    VARCHAR(128),                        -- client-provided; prevents double charges
  sender_wallet_id   UUID REFERENCES wallets(id) ON DELETE SET NULL,
  receiver_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  amount_minor       BIGINT NOT NULL CHECK (amount_minor > 0),
  currency           CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  type               VARCHAR(24) NOT NULL
                     CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'AIRTIME', 'BILLS', 'FUNDING', 'WITHDRAWAL', 'REVERSAL')),
  status             VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED')),
  narration          VARCHAR(255),
  failure_reason     VARCHAR(255),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

-- Speed: lookups by side, by time, and idempotency re-checks.
CREATE INDEX idx_transactions_sender_wallet_id    ON transactions(sender_wallet_id);
CREATE INDEX idx_transactions_receiver_wallet_id  ON transactions(receiver_wallet_id);
CREATE INDEX idx_transactions_created_at          ON transactions(created_at DESC);
CREATE INDEX idx_transactions_idempotency_key     ON transactions(idempotency_key)
                                                   WHERE idempotency_key IS NOT NULL;

-- IDEMPOTENCY backbone:
-- A given sender may only use a given idempotency key once, for transfers.
-- The second attempt is rejected by the database and we return the first result.
CREATE UNIQUE INDEX uq_transactions_sender_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'TRANSFER';