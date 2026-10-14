-- 018_security_and_kyc.sql
-- A) Richer bio fields so a user can complete more of their profile before and
--    alongside NIN/BVN verification: occupation + next of kin.
-- B) sessions get a last_seen marker powering the "active sessions" manager.

ALTER TABLE users
  ADD COLUMN occupation           VARCHAR(120),
  ADD COLUMN next_of_kin_name     VARCHAR(120),
  ADD COLUMN next_of_kin_phone    VARCHAR(20),
  ADD COLUMN next_of_kin_relation VARCHAR(40);

ALTER TABLE sessions
  ADD COLUMN last_seen_at TIMESTAMPTZ;