-- 035_cargo_notifications.sql
-- Agbede Cargo introduces its own notification family so the tray can show the
-- right icon and the deep-link to a request. Extend the allowed types; existing
-- rows are untouched.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRANSACTION', 'SAVINGS', 'SECURITY', 'KYC', 'PROMO',
                  'SYSTEM', 'DISPATCH', 'RIDE', 'WITHDRAW', 'SUPPORT', 'CARGO'));
