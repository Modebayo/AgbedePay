-- 009_savings_idempotency.sql
-- Savings deposits are money movement too: a double-click must charge once.
-- Same idempotency backbone as transfers, scoped to SAVINGS_DEPOSIT rows.

CREATE UNIQUE INDEX uq_transactions_savings_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'SAVINGS_DEPOSIT';