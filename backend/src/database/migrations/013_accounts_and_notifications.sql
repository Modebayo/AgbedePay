-- 013_accounts_and_notifications.sql
-- Bank accounts users can cash out to, plus in-app notifications.
-- Bank account NUMBER is kept plaintext (it is the routing key for payouts),
-- but real systems hash / tokenise it with a payout provider. AgbedePay stores
-- only what the mock-provider payout needs.

CREATE TABLE bank_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name      VARCHAR(80) NOT NULL,
  account_name   VARCHAR(120) NOT NULL,
  account_number VARCHAR(12) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One person may link the same account number only once.
CREATE UNIQUE INDEX uq_bank_accounts_user_number ON bank_accounts(user_id, account_number);
CREATE INDEX idx_bank_accounts_user_id ON bank_accounts(user_id);

-- Link a payout account to a ledger row (for receipts/history).
ALTER TABLE transactions ADD COLUMN bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;

-- NOTIFICATIONS
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(24) NOT NULL CHECK (type IN
              ('TRANSACTION', 'SAVINGS', 'SECURITY', 'KYC', 'PROMO', 'SYSTEM')),
  title      VARCHAR(120) NOT NULL,
  body       VARCHAR(500),
  read_at    TIMESTAMPTZ,                 -- NULL = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Withdrawal idempotency: one (wallet, key) per WITHDRAWAL, mirroring the
-- FUNDING / TRANSFER / SAVINGS_DEPOSIT / purchase indexes.
CREATE UNIQUE INDEX uq_transactions_withdrawal_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'WITHDRAWAL';