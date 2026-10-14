-- 020_dispatch_and_ride.sql
-- Two modules land together on one shared scaffold:
--   1) first-class ledger types (DISPATCH, RIDE) + their idempotency backbone,
--      so "book a rider" is as replay-safe as any other money move
--   2) user_places — saved Home/Office favourites for pickups and drop-offs
--   3) dispatch_bookings — package delivery + errand service
--   4) ride_bookings — ride-hailing (Economy / Comfort / Bargain)
--
-- A booking HOLDS its fare on the wallet ledger (status PENDING = escrow),
-- releases it (SUCCESS) when the job/trip completes, and refunds it
-- (REVERSED + a REVERSAL row) when cancelled — see the service docs.

-- 1) Ledger types.
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('TRANSFER', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'AIRTIME',
                  'BILLS', 'FUNDING', 'WITHDRAWAL', 'REVERSAL', 'BETTING', 'BANK',
                  'DISPATCH', 'RIDE'));

-- One (wallet, key) per DISPATCH row, so a double-clicked "Book" replays the
-- original outcome instead of debiting twice.
CREATE UNIQUE INDEX uq_transactions_dispatch_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'DISPATCH';

CREATE UNIQUE INDEX uq_transactions_ride_idempotency
ON transactions(sender_wallet_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND type = 'RIDE';

-- 2) Saved places — one favourite per label per person.
CREATE TABLE user_places (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         VARCHAR(24) NOT NULL,
  address       VARCHAR(180) NOT NULL,
  contact_phone VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_user_places_user_label ON user_places(user_id, LOWER(label));
CREATE INDEX idx_user_places_user_id ON user_places(user_id);

-- 3) Dispatch bookings — packages + errands.
CREATE TABLE dispatch_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type      VARCHAR(16) NOT NULL CHECK (service_type IN ('PACKAGE', 'ERRAND')),
  item_type         VARCHAR(16) NOT NULL CHECK (item_type IN ('DOCUMENT', 'SMALL', 'MEDIUM', 'FRAGILE', 'HEAVY')),
  vehicle_type      VARCHAR(16) NOT NULL CHECK (vehicle_type IN ('BIKE', 'CAR', 'VAN')),
  pickup_address    VARCHAR(180) NOT NULL,
  pickup_contact    VARCHAR(20) NOT NULL,
  pickup_lat        DOUBLE PRECISION NOT NULL,
  pickup_lng        DOUBLE PRECISION NOT NULL,
  dropoff_address   VARCHAR(180) NOT NULL,
  dropoff_contact   VARCHAR(20) NOT NULL,
  dropoff_lat       DOUBLE PRECISION NOT NULL,
  dropoff_lng       DOUBLE PRECISION NOT NULL,
  distance_km       NUMERIC(6, 2) NOT NULL CHECK (distance_km > 0),
  est_duration_min  INT NOT NULL,
  fare_breakdown    JSONB NOT NULL,
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  delivery_otp_hash VARCHAR(64) NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'BOOKED'
                    CHECK (status IN ('BOOKED', 'RIDER_ASSIGNED', 'PICKED_UP',
                                      'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
  rider_name        VARCHAR(120),
  rider_phone       VARCHAR(20),
  rider_vehicle     VARCHAR(80),
  rider_plate       VARCHAR(20),
  rider_rating      NUMERIC(2, 1),
  rider_trips       INT,
  rating            SMALLINT CHECK (rating BETWEEN 1 AND 5),
  rating_tags       VARCHAR(255),
  issue_type        VARCHAR(40),
  issue_note        VARCHAR(300),
  transaction_id    UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_user_created ON dispatch_bookings(user_id, created_at DESC);

-- 4) Ride bookings — Economy / Comfort / Bargain.
CREATE TABLE ride_bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                VARCHAR(16) NOT NULL CHECK (tier IN ('ECONOMY', 'COMFORT', 'BARGAIN')),
  passengers          SMALLINT NOT NULL DEFAULT 1 CHECK (passengers BETWEEN 1 AND 6),
  pickup_address      VARCHAR(180) NOT NULL,
  pickup_contact      VARCHAR(20) NOT NULL,
  pickup_lat          DOUBLE PRECISION NOT NULL,
  pickup_lng          DOUBLE PRECISION NOT NULL,
  dropoff_address     VARCHAR(180) NOT NULL,
  dropoff_lat         DOUBLE PRECISION NOT NULL,
  dropoff_lng         DOUBLE PRECISION NOT NULL,
  distance_km         NUMERIC(6, 2) NOT NULL CHECK (distance_km > 0),
  est_duration_min    INT NOT NULL,
  fare_breakdown      JSONB NOT NULL,
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  tip_minor           BIGINT NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  bargain_offer_minor BIGINT CHECK (bargain_offer_minor IS NULL OR bargain_offer_minor > 0),
  status              VARCHAR(24) NOT NULL DEFAULT 'SEARCHING'
                      CHECK (status IN ('SEARCHING', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING',
                                        'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  driver_name         VARCHAR(120),
  driver_phone        VARCHAR(20),
  driver_car          VARCHAR(80),
  driver_color        VARCHAR(40),
  driver_plate        VARCHAR(20),
  driver_rating       NUMERIC(2, 1),
  driver_trips        INT,
  contact_for_share   VARCHAR(120),
  rating              SMALLINT CHECK (rating BETWEEN 1 AND 5),
  rating_tags         VARCHAR(255),
  issue_type          VARCHAR(40),
  issue_note          VARCHAR(300),
  transaction_id      UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_user_created ON ride_bookings(user_id, created_at DESC);