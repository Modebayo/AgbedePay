-- 024_wealth.sql
-- The WEALTH section: everything a customer holds that is not cash in a wallet.
--
-- Four tables, one shared spine:
--   1) wealth_instruments — the catalogue. Every class (STOCK, FUND, PENSION,
--      BOND) lives in ONE table so Portfolio, History and the order flow can
--      treat them uniformly. Seeded with real NGX tickers plus indicative
--      rates for the classes that have no free live feed.
--   2) wealth_holdings    — a user's position in one instrument. Fractional
--      units are stored as INTEGER hundred-thousandths (see below), so a
--      "0.3742 share" is still whole-number math and never a float.
--   3) wealth_orders      — the wealth ledger. Every buy and every sell is a
--      row here; this is what Investment History reads.
--   4) wealth_goals       — retirement targets. Endpoints land with the
--      Retirement Goal page; the table ships now so the Wealth schema is
--      complete in one migration.
--
-- UNITS. `units_minor` counts hundred-thousandths of one unit (UNIT_SCALE =
-- 100000), so 1 whole share = 100000. Amount in kobo is therefore
-- amount = units_minor * unit_price_minor / UNIT_SCALE, rounded DOWN — the
-- customer is never charged for a fraction of a kobo they didn't ask for.
--
-- PRICING. STOCK rows are revalued from the live NGX feed
-- (services/wealthPricingService.js) on every read. FUND, PENSION and BOND
-- have no keyless live feed, so their prices are INDICATIVE seeded values and
-- are served with live = false so the UI can say so honestly — see the same
-- rule in services/marketService.js ("REAL data, never AI-generated").

-- 1) Ledger types for wealth movement, and their idempotency backbone.
-- A double-tapped "Buy" must replay the original order, not buy twice.
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'AIRTIME',
                  'BILLS', 'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING', 'BANK',
                  'DISPATCH', 'RIDE', 'WEALTH_BUY', 'WEALTH_SELL'));

CREATE UNIQUE INDEX uq_transactions_wealth_buy_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'WEALTH_BUY';

CREATE UNIQUE INDEX uq_transactions_wealth_sell_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'WEALTH_SELL';

-- 2) The instrument catalogue.
CREATE TABLE wealth_instruments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            VARCHAR(24) NOT NULL UNIQUE,   -- NGX ticker, e.g. DANGCEM
  name              VARCHAR(160) NOT NULL,
  class             VARCHAR(12) NOT NULL
                     CHECK (class IN ('STOCK', 'FUND', 'PENSION', 'BOND')),
  issuer            VARCHAR(160),
  sector            VARCHAR(80),
  -- Last known price in kobo. Live for STOCK, indicative for the rest.
  unit_price_minor  BIGINT NOT NULL CHECK (unit_price_minor > 0),
  -- Previous close in kobo, so we can show a day change without re-fetching.
  prev_close_minor  BIGINT,
  -- Annualised yield as a percentage, for the classes that quote one
  -- (BOND coupon, PENSION/FUND trailing yield). NULL where not meaningful.
  yield_pct         NUMERIC(6, 3) CHECK (yield_pct IS NULL OR yield_pct >= 0),
  risk_level        VARCHAR(8) NOT NULL DEFAULT 'MEDIUM'
                    CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  -- TRUE only when the price came off a live feed on the last refresh.
  is_live           BOOLEAN NOT NULL DEFAULT FALSE,
  -- When unit_price_minor was last written, so the UI can be honest about age.
  priced_at         TIMESTAMPTZ,
  status            VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wealth_instruments_class ON wealth_instruments(class, status);
-- Only STOCKs are ever refreshed from the live feed.
CREATE INDEX idx_wealth_instruments_live  ON wealth_instruments(symbol)
                                           WHERE class = 'STOCK';

CREATE TRIGGER wealth_instruments_set_updated_at
BEFORE UPDATE ON wealth_instruments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) What the customer actually holds.
-- One ACTIVE holding per (person, instrument): buying more adds units and
-- updates the average cost rather than creating a second row.
CREATE TABLE wealth_holdings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id    UUID NOT NULL REFERENCES wealth_instruments(id) ON DELETE RESTRICT,
  units_minor      BIGINT NOT NULL CHECK (units_minor > 0),  -- hundred-thousandths
  -- Weighted-average cost in kobo per whole unit, kept in sync on every order.
  avg_cost_minor   BIGINT NOT NULL CHECK (avg_cost_minor > 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'SOLD')),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_wealth_holdings_active
ON wealth_holdings(user_id, instrument_id)
WHERE status = 'ACTIVE';

CREATE INDEX idx_wealth_holdings_user_id ON wealth_holdings(user_id, status);

CREATE TRIGGER wealth_holdings_set_updated_at
BEFORE UPDATE ON wealth_holdings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) The wealth ledger. Investment History reads this and nothing else, so a
-- closed position still has a full, auditable trail.
CREATE TABLE wealth_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holding_id       UUID REFERENCES wealth_holdings(id) ON DELETE SET NULL,
  instrument_id    UUID NOT NULL REFERENCES wealth_instruments(id) ON DELETE RESTRICT,
  type             VARCHAR(8) NOT NULL CHECK (type IN ('BUY', 'SELL')),
  -- Both sides of the trade, captured at execution time and never rewritten.
  units_minor      BIGINT NOT NULL CHECK (units_minor > 0),
  amount_minor     BIGINT NOT NULL CHECK (amount_minor > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor > 0),
  reference        VARCHAR(64) NOT NULL UNIQUE,
  -- Joins to the wallet-level transactions row for the same movement.
  transaction_id   UUID REFERENCES transactions(id) ON DELETE SET NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
                   CHECK (status IN ('SUCCESS', 'FAILED', 'REVERSED')),
  failure_reason   VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wealth_orders_user_created ON wealth_orders(user_id, created_at DESC);
CREATE INDEX idx_wealth_orders_instrument   ON wealth_orders(instrument_id);
-- Idempotency re-check joins on the shared reference, like savings does.
CREATE INDEX idx_wealth_orders_reference    ON wealth_orders(reference);

-- 5) Retirement goals. Savings goals answer "how much for a laptop";
-- these answer "how much by the time I stop working", which is why they carry
-- a monthly contribution and a projected completion date.
CREATE TABLE wealth_goals (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                          VARCHAR(120) NOT NULL,
  target_age                    SMALLINT NOT NULL
                                CHECK (target_age BETWEEN 40 AND 100),
  current_age                   SMALLINT NOT NULL
                                CHECK (current_age BETWEEN 18 AND 100),
  target_amount_minor           BIGINT NOT NULL CHECK (target_amount_minor > 0),
  current_amount_minor          BIGINT NOT NULL DEFAULT 0
                                CHECK (current_amount_minor >= 0),
  monthly_contribution_minor    BIGINT NOT NULL DEFAULT 0
                                CHECK (monthly_contribution_minor >= 0),
  target_date                   DATE NOT NULL,
  status                        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'ACHIEVED', 'CLOSED')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- You cannot already be older than the age you are saving to.
  CONSTRAINT wealth_goals_age_order CHECK (target_age > current_age)
);

CREATE INDEX idx_wealth_goals_user_id ON wealth_goals(user_id);

CREATE TRIGGER wealth_goals_set_updated_at
BEFORE UPDATE ON wealth_goals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) Wealth gets its own notification family so the tray can show a distinct
-- icon instead of routing investment notices through SYSTEM.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRANSACTION', 'SAVINGS', 'SECURITY', 'KYC', 'PROMO',
                  'SYSTEM', 'DISPATCH', 'RIDE', 'WITHDRAW', 'SUPPORT', 'WEALTH'));
