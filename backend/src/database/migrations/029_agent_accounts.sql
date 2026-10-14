-- 029_agent_accounts.sql
-- Cash-agent cash-out destinations.
--
-- Withdrawals can now go to a bank account (kind = 'PAYOUT') OR a cash agent
-- (kind = 'AGENT'). Two existing constraints assumed only payout/beneficiary
-- rows existed:
--   1) bank_accounts_kind_check only permitted ('PAYOUT', 'BENEFICIARY').
--   2) uq_bank_accounts_user_number was UNIQUE (user_id, account_number), so a
--      number could not be reused across kinds and an AGENT insert hit a 500.
-- Both are corrected here. The uniqueness rule becomes "one row per
-- (user, kind, account_number)".

-- 1) Admit 'AGENT' as a destination kind. The original constraint was declared
--    inline (auto-named), so drop whatever CHECK on this table mentions `kind`
--    before adding the explicit replacement.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'bank_accounts'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE bank_accounts DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_kind_check
  CHECK (kind IN ('PAYOUT', 'BENEFICIARY', 'AGENT'));

-- 2) Scope the account-number uniqueness to the kind.
DROP INDEX IF EXISTS uq_bank_accounts_user_number;

CREATE UNIQUE INDEX uq_bank_accounts_user_kind_number
  ON bank_accounts(user_id, kind, account_number);
