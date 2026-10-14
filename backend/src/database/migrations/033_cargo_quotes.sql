-- 033_cargo_quotes.sql
-- Agbede Cargo: larger, non-instant freight. A customer submits a quotation
-- REQUEST (pickup, destination, cargo description, contact details); an admin
-- reviews it and can attach a quote. No money moves here — a quote is closed
-- offline — so there is deliberately no wallet/ledger coupling.
CREATE TABLE cargo_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference             VARCHAR(24) NOT NULL UNIQUE,
  pickup_address        VARCHAR(180) NOT NULL,
  dropoff_address       VARCHAR(180) NOT NULL,
  cargo_type            VARCHAR(60)  NOT NULL,
  approx_weight_kg      NUMERIC(10, 2) CHECK (approx_weight_kg IS NULL OR approx_weight_kg > 0),
  dimensions            VARCHAR(80),
  vehicle_requirements  VARCHAR(120),
  collection_date       DATE,
  contact_name          VARCHAR(120) NOT NULL,
  contact_phone         VARCHAR(20)  NOT NULL,
  notes                 VARCHAR(500),
  status                VARCHAR(16) NOT NULL DEFAULT 'REQUESTED'
                        CHECK (status IN ('REQUESTED', 'QUOTED', 'ACCEPTED', 'CLOSED', 'CANCELLED')),
  -- Filled in by an admin when the request is priced.
  quoted_amount_minor   BIGINT CHECK (quoted_amount_minor IS NULL OR quoted_amount_minor > 0),
  admin_note            VARCHAR(500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cargo_quotes_user_created ON cargo_quotes(user_id, created_at DESC);
CREATE INDEX idx_cargo_quotes_status ON cargo_quotes(status, created_at DESC);
