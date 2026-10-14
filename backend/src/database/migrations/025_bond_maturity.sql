-- 025_bond_maturity.sql
-- The one thing a Nigerian treasury bill is not without: the date it matures.
--
-- WHY A SEPARATE MIGRATION
-- Migration 024 created the instrument catalogue with a `yield_pct` and an
-- `issuer`, which is enough to price a bond but not enough to describe one. A
-- bond page that cannot say "matures 2031 · 1.75 years left" is a page showing
-- a yield and a price with the single most important fact missing, so the
-- column is added here rather than folded into a rewrite of 024.
--
-- NULLABLE, and deliberately not enforced per-class. `class <> 'BOND' OR
-- maturity_date IS NOT NULL` would be a nice constraint and it is also a
-- migration that cannot be applied to an existing database without a
-- backfill, and it would break the day someone lists a perpetuity or a
-- call/put bond whose maturity is genuinely unknown. The Bonds page is the
-- right place to make the field mandatory, and it simply omits the maturity
-- line when there is nothing to print — the same rule the price badge follows.
--
-- A date rather than a tenor. "91 days" goes stale the moment it is stored; a
-- maturity date stays true forever, and the remaining tenor is derived at read
-- time. FGN treasury bills are auctioned with a tenor, but the thing a
-- customer is really buying is the date their money comes back.

ALTER TABLE wealth_instruments
  ADD COLUMN IF NOT EXISTS maturity_date DATE;

COMMENT ON COLUMN wealth_instruments.maturity_date IS
  'Date the instrument matures and returns principal. Set for BOND rows; NULL for classes that never mature (perpetual funds, equities).';

-- The Bonds page sorts by soonest maturity and filters on class, and it does
-- that on every request. A partial index on the non-null rows only is a fraction
-- of the size of a plain one, because STOCK and FUND rows are the majority of
-- the table and never carry a date at all.
CREATE INDEX IF NOT EXISTS idx_wealth_instruments_maturity
  ON wealth_instruments(maturity_date)
  WHERE class = 'BOND' AND maturity_date IS NOT NULL;
