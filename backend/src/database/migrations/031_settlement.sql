-- 031_settlement.sql
-- Driver settlement: when a trip completes, the customer's escrowed fare is
-- released and the driver is paid their net (fare − platform commission) into
-- their wallet. Each completion writes exactly one driver_earnings row so the
-- driver's history and the ledger can never disagree.
--
-- Money model (MVP, simulated): the customer was debited the full fare when
-- they booked (PENDING escrow). On completion that debit is finalised
-- (SUCCESS) and the driver is credited the net. The commission stays with the
-- platform. A DRIVER_EARNING ledger row records the credit.

-- 1) New ledger type for the driver's payout, plus its idempotency backbone:
--    one DRIVER_EARNING per (driver wallet, key) so a retried "complete" can
--    never pay twice.
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'AIRTIME',
                  'BILLS', 'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING', 'BANK',
                  'DISPATCH', 'RIDE', 'WEALTH_BUY', 'WEALTH_SELL', 'DRIVER_EARNING'));

CREATE UNIQUE INDEX uq_transactions_driver_earning_idempotency
ON transactions(receiver_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'DRIVER_EARNING';

-- 2) Per-completion earnings ledger. gross = what the customer paid,
--    commission = the platform's cut, net = credited to the driver.
CREATE TABLE driver_earnings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_kind     VARCHAR(8) NOT NULL CHECK (booking_kind IN ('RIDE', 'DISPATCH')),
  booking_id       UUID NOT NULL,
  gross_minor      BIGINT NOT NULL CHECK (gross_minor > 0),
  commission_minor BIGINT NOT NULL CHECK (commission_minor >= 0),
  net_minor        BIGINT NOT NULL CHECK (net_minor >= 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'SETTLED'
                   CHECK (status IN ('PENDING', 'SETTLED')),
  transaction_id   UUID REFERENCES transactions(id) ON DELETE SET NULL,
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one earnings row per completed booking.
  UNIQUE (booking_kind, booking_id)
);

CREATE INDEX idx_driver_earnings_driver
  ON driver_earnings(driver_user_id, created_at DESC);
