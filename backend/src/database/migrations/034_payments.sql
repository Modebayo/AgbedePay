-- 034_payments.sql
-- Hosted-checkout payments (Paystack first, Flutterwave scaffolded). A
-- payment_transactions row tracks one checkout attempt from PENDING → SUCCESS
-- (or FAILED). When it succeeds, the linked wallet ledger row funds the
-- wallet — exactly once, guaranteed by the unique reference + the wallet's own
-- idempotency.
--
-- payment_events is the webhook inbox: providers retry webhooks, so the same
-- event can arrive many times. UNIQUE(provider, event_id) makes replay a no-op.
CREATE TABLE payment_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              VARCHAR(20) NOT NULL CHECK (provider IN ('PAYSTACK', 'FLUTTERWAVE', 'MOCK')),
  reference             VARCHAR(64) NOT NULL UNIQUE,
  provider_ref          VARCHAR(128),
  amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
  currency              CHAR(3) NOT NULL DEFAULT 'NGN',
  purpose               VARCHAR(16) NOT NULL DEFAULT 'WALLET_FUNDING'
                        CHECK (purpose IN ('WALLET_FUNDING', 'RIDE', 'DISPATCH')),
  status                VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED')),
  wallet_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_transactions_user ON payment_transactions(user_id, created_at DESC);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status, created_at DESC);

CREATE TABLE payment_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     VARCHAR(20) NOT NULL,
  -- The provider's own event identifier; the dedupe key for replays.
  event_id     VARCHAR(128) NOT NULL,
  event_type   VARCHAR(64),
  payload      JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
