-- 001_core.sql
-- Shared building blocks every later migration uses.

-- A trigger function that stamps `updated_at = now()` on any row
-- that is updated, so we never forget to set it by hand.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;