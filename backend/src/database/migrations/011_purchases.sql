-- 011_purchases.sql
-- Idempotency backbone for airtime & bills purchases, mirroring transfers:
-- one (sender wallet, idempotency key) may only ever produce ONE charge.
CREATE UNIQUE INDEX uq_transactions_purchase_idempotency
ON transactions (sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type IN ('AIRTIME', 'BILLS');