-- 019_security_alert_and_savings_withdrawal.sql
-- Two features land together:
--   1) Security alerts — opt-in notice whenever a NEW device signs in.
--   2) Savings withdrawal — money moves goal -> wallet, so it needs its own
--      ledger type and its own idempotency backbone (same pattern as deposits).

-- 1) Per-user toggle for new-device sign-in alerts.
ALTER TABLE users ADD COLUMN security_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Goal withdrawal is the mirror image of SAVINGS_DEPOSIT: money IN becomes
--    money OUT back to the wallet. Give it a first-class ledger type so history
--    can tell "saved into a goal" from "took back out of a goal".
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'AIRTIME',
                  'BILLS', 'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING', 'BANK'));

-- Idempotency: one (wallet, key) per SAVINGS_WITHDRAWAL row, so a double-clicked
-- "Withdraw" replays the original outcome instead of crediting the wallet twice.
CREATE UNIQUE INDEX uq_transactions_savings_withdrawal_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'SAVINGS_WITHDRAWAL';
