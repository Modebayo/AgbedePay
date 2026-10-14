-- 023_notification_types.sql
-- Give each notification family its own type so the tray can show a distinct
-- icon per event, instead of routing dispatch/ride/withdraw/support notices
-- through the generic SYSTEM bucket.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRANSACTION', 'SAVINGS', 'SECURITY', 'KYC', 'PROMO',
                  'SYSTEM', 'DISPATCH', 'RIDE', 'WITHDRAW', 'SUPPORT'));

-- Re-tag existing dispatch / ride / trip notices written before this split.
UPDATE notifications SET type = 'DISPATCH'
 WHERE type = 'SYSTEM'
   AND (title ILIKE 'Pickup%' OR title ILIKE 'Delivery%' OR title ILIKE 'Package%');

UPDATE notifications SET type = 'RIDE'
 WHERE type = 'SYSTEM'
   AND (title ILIKE 'Ride %' OR title ILIKE 'Trip %' OR title ILIKE 'Live %');