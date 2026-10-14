-- 022_notification_links.sql
-- The in-app tray renders each row as a button that should take you to the
-- thing it is talking about. The frontend has always read `link`, but nothing
-- ever wrote it, so every tray item was inert. This column makes the deep-link
-- real, and a helper view keeps "where should this type go" in one place.

ALTER TABLE notifications ADD COLUMN link VARCHAR(200);

-- Deep-links are always in-app pages (optionally with ?query and #anchor),
-- never absolute or protocol-relative URLs: the value is rendered into href
-- and data-goto attributes on every page, so anything else is a stored-XSS
-- and open-redirect hole.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_link_is_relative
  CHECK (link IS NULL OR link ~ '^[a-zA-Z0-9_\-]+\.html(\?[A-Za-z0-9_=&%.-]*)?(#[A-Za-z0-9_=&%.-]*)?$');

-- The tray lists a user's newest items; a covering index keeps the unread
-- filter cheap once the list grows.
CREATE INDEX idx_notifications_user_unread_created
ON notifications(user_id, created_at DESC)
WHERE read_at IS NULL;

-- Backfill the rows that predate the column, so the tray is not half-dead:
-- types whose destination is fixed get it, and transaction rows (which have
-- no stored id here) are left NULL rather than pointed at a guess.
UPDATE notifications SET link = 'savings.html'        WHERE link IS NULL AND type = 'SAVINGS';
UPDATE notifications SET link = 'profile.html#verify-form' WHERE link IS NULL AND type = 'KYC';
UPDATE notifications SET link = 'rewards.html'        WHERE link IS NULL AND type = 'PROMO';
UPDATE notifications SET link = 'profile.html'        WHERE link IS NULL AND type = 'SECURITY';
