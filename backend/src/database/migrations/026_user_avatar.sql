-- 026_user_avatar.sql
-- Profile picture.
--
-- STORED WHERE: the file itself lives on disk under backend/storage/avatars/,
-- NOT in the database and NOT under frontend/. That last part matters:
-- frontend/ is served by express.static with no auth, so anything written there
-- becomes world-readable to anyone who learns the filename. These are served
-- instead by an authenticated route (GET /api/users/avatar).
--
-- WHY ONLY THE FILENAME IS STORED, NOT A PUBLIC URL: the column deliberately
-- holds a bare server-side filename like "8f3c1a2e-....jpg" and never a full
-- URL. That makes it impossible for a stored value to point somewhere external
-- (an attacker-supplied "https://evil.example/x.png" pasted into the DB could
-- not become an <img src> that phones home), and it means the route that
-- decides whether to serve the file stays in one place.
--
-- WHY NOT base64 IN THE COLUMN: profile reads happen on nearly every page (the
-- topbar avatar), and Postgres is the wrong place for image blobs. It would
-- bloat every row fetch and make backups enormous for no benefit.

ALTER TABLE users
  ADD COLUMN avatar_filename VARCHAR(255),
  ADD COLUMN avatar_mime       VARCHAR(40),
  ADD COLUMN avatar_size_bytes INTEGER,
  ADD COLUMN avatar_updated_at TIMESTAMPTZ;

-- The size is bounded by the upload middleware, but a CHECK makes the
-- invariant true in the database too, so no future write path can bypass it.
ALTER TABLE users
  ADD CONSTRAINT avatar_size_bytes_positive
    CHECK (avatar_size_bytes IS NULL OR avatar_size_bytes > 0);

-- Partial index: only a minority of users have an avatar, and every avatar
-- request looks the row up by id, so this stays tiny. The predicate keeps the
-- index from carrying a NULL entry for every user who never set a picture.
CREATE INDEX idx_users_avatar ON users (id) WHERE avatar_filename IS NOT NULL;
