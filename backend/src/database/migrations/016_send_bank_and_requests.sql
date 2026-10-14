-- 016_send_bank_and_requests.sql
-- OPay-style sending for AgbedePay:
--   1) send money to ANY bank account (beneficiary, not a self-cash-out)
--   2) request money ("ask so-and-so to pay you back")

-- 1) Extend transactions.type to admit 'BANK' (send-money-to-bank).
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'AIRTIME', 'BILLS',
                  'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING', 'BANK'));

-- 2) Idempotency for BANK sends: one (wallet, key) per type 'BANK'. Matching
--    the withdrawal index, a double-clicked bank transfer replays instead of
--    debiting twice.
CREATE UNIQUE INDEX uq_transactions_bank_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'BANK';

-- 3) Distinguish payout accounts (cash-out destinations) from send-money
--    beneficiaries, so the two never mix in the UI.
ALTER TABLE bank_accounts
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'PAYOUT'
  CHECK (kind IN ('PAYOUT', 'BENEFICIARY'));

CREATE INDEX idx_bank_accounts_kind ON bank_accounts(user_id, kind);

-- 4) Payment requests — OPay "request money" record. A request is created by
--    the would-be receiver, addressed to a phone number, and settled by a
--    normal TRANSFER from the payer's wallet once they pay it.
CREATE TABLE payment_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_phone    VARCHAR(20) NOT NULL,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
  note           VARCHAR(255),
  status         VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ
);

-- One OPEN request per (requester, payer) at a time; a new one is allowed once
-- the previous has been paid or cancelled.
CREATE UNIQUE INDEX uq_payment_requests_pending
ON payment_requests(requester_id, payer_phone) WHERE status = 'PENDING';

CREATE INDEX idx_payment_requests_incoming
ON payment_requests(payer_phone, status, created_at DESC);

CREATE INDEX idx_payment_requests_requester
ON payment_requests(requester_id, created_at DESC);