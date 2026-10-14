-- 032_pricing_rules.sql
-- Move fares out of hardcoded provider constants and into the database, so the
-- fare a customer is quoted is server-authoritative, auditable, and adjustable
-- without a deploy. A rule is keyed by (service, key):
--   service RIDE     → key is the tier      (ECONOMY / COMFORT / BARGAIN)
--   service DISPATCH → key is the vehicle   (BIKE / CAR / VAN)
--
-- Surge is a flat multiplier applied when the trip distance exceeds
-- surge_threshold_km (0 = never surge). commission_bp is the platform's cut.
CREATE TABLE pricing_rules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service              VARCHAR(16) NOT NULL CHECK (service IN ('RIDE', 'DISPATCH')),
  key                  VARCHAR(24) NOT NULL,
  label                VARCHAR(40) NOT NULL,
  base_minor           BIGINT NOT NULL CHECK (base_minor >= 0),
  per_km_minor         BIGINT NOT NULL CHECK (per_km_minor >= 0),
  min_fare_minor       BIGINT NOT NULL DEFAULT 0 CHECK (min_fare_minor >= 0),
  -- Short trips (distance <= threshold) are never surged; longer ones are.
  surge_threshold_km   NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (surge_threshold_km >= 0),
  surge_multiplier     NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (surge_multiplier >= 1.00),
  commission_bp        INT NOT NULL DEFAULT 1500 CHECK (commission_bp BETWEEN 0 AND 10000),
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service, key)
);

-- Seed with the values the mock providers used, so nothing about pricing
-- changes the day this ships — it just becomes editable.
INSERT INTO pricing_rules
  (service, key, label, base_minor, per_km_minor, min_fare_minor, surge_threshold_km, surge_multiplier, commission_bp)
VALUES
  ('RIDE', 'ECONOMY', 'Economy', 30000, 10000, 50000,  0, 1.00, 1500),
  ('RIDE', 'COMFORT', 'Comfort', 50000, 16000, 80000,  0, 1.00, 1800),
  ('RIDE', 'BARGAIN', 'Bargain', 25000,  8000, 40000,  0, 1.00, 1200),
  ('DISPATCH', 'BIKE', 'Bike',   15000,  2500, 20000,  0, 1.00, 1500),
  ('DISPATCH', 'CAR',  'Car',    30000,  5000, 40000,  0, 1.00, 1500),
  ('DISPATCH', 'VAN',  'Van',    55000,  7500, 70000,  0, 1.00, 1500)
ON CONFLICT (service, key) DO NOTHING;
