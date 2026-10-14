-- 012_funding_idempotency.sql
-- Wallet top-ups are money movement too: a double-clicked "Add money" must
-- credit once. Same idempotency backbone as transfers, scoped to FUNDING rows.

CREATE UNIQUE INDEX uq_transactions_funding_idempotency
ON transactions (sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'FUNDING';