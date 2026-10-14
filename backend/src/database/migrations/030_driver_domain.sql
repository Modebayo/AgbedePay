-- 030_driver_domain.sql
-- Agbede Driver vertical: give users a role, let a DRIVER carry a profile and a
-- live presence flag, and let a booking be assigned to a real driver account
-- (instead of the hardcoded mock driver). The trip is driven by the driver —
-- they accept an offer, then advance arrived → started → completed.
--
-- Roles: CUSTOMER (default, everyone today), DRIVER, ADMIN.

-- 1) Roles live on users, so one account system serves customers, drivers and
--    admins. Existing accounts are customers.
ALTER TABLE users
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('CUSTOMER', 'DRIVER', 'ADMIN'));

CREATE INDEX idx_users_role ON users(role);

-- 2) One driver profile per DRIVER account (1:1). Holds the vehicle, the
--    earnings rate, lifetime stats, and the driver's live availability. A
--    driver is invisible to dispatch until an admin approves them
--    (status PENDING → ACTIVE); SUSPENDED takes them off the road.
CREATE TABLE driver_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type     VARCHAR(16) NOT NULL DEFAULT 'CAR'
                   CHECK (vehicle_type IN ('BIKE', 'CAR', 'VAN')),
  car_make_model   VARCHAR(80)  NOT NULL,
  car_color        VARCHAR(40)  NOT NULL,
  plate_number     VARCHAR(20)  NOT NULL,
  -- Platform's cut of each completed trip, in basis points (1500 = 15%).
  commission_bp    INT NOT NULL DEFAULT 1500 CHECK (commission_bp BETWEEN 0 AND 10000),
  rating           NUMERIC(2, 1) NOT NULL DEFAULT 5.0 CHECK (rating BETWEEN 0 AND 5),
  trips_completed  INT NOT NULL DEFAULT 0 CHECK (trips_completed >= 0),
  -- Approval + availability.
  status           VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
  is_online        BOOLEAN NOT NULL DEFAULT false,
  last_seen_at     TIMESTAMPTZ,
  last_lat         DOUBLE PRECISION,
  last_lng         DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_profiles_status_online
  ON driver_profiles(status, is_online);

-- 3) Offers: a booking is pushed to one or more nearby online drivers with an
--    expiry. Accepting is an atomic conditional UPDATE (see driverModel) so two
--    drivers can never win the same job. UNIQUE prevents duplicate offers.
CREATE TABLE driver_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_kind    VARCHAR(8) NOT NULL CHECK (booking_kind IN ('RIDE', 'DISPATCH')),
  booking_id      UUID NOT NULL,
  driver_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(12) NOT NULL DEFAULT 'OFFERED'
                  CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  expires_at      TIMESTAMPTZ NOT NULL,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_kind, booking_id, driver_user_id)
);

CREATE INDEX idx_driver_offers_driver_status
  ON driver_offers(driver_user_id, status, expires_at);

CREATE INDEX idx_driver_offers_booking
  ON driver_offers(booking_kind, booking_id);

-- 4) Link a booking to the real driver who took it. NULL until someone accepts.
--    accepted_at records when the job was claimed (used for ETAs / audits).
ALTER TABLE ride_bookings
  ADD COLUMN driver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN accepted_at    TIMESTAMPTZ;

ALTER TABLE dispatch_bookings
  ADD COLUMN driver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN accepted_at    TIMESTAMPTZ;

CREATE INDEX idx_ride_bookings_driver ON ride_bookings(driver_user_id, created_at DESC);
CREATE INDEX idx_dispatch_bookings_driver ON dispatch_bookings(driver_user_id, created_at DESC);
