-- 014_betting.sql
-- Betting top-ups ride the same purchase path as airtime & bills.
-- 1) Extend the transactions.type CHECK constraint to admit BETTING.
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'AIRTIME', 'BILLS',
                  'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING'));

-- 2) Rebuild the purchase idempotency index so BETTING keys are also unique.
--    A partial index's predicate changed, so the old one must be replaced.
DROP INDEX IF EXISTS uq_transactions_purchase_idempotency;
CREATE UNIQUE INDEX uq_transactions_purchase_idempotency
ON transactions (sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type IN ('AIRTIME', 'BILLS', 'BETTING');