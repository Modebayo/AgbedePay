-- 036_agbede_account_numbers.sql
-- Every AgbedePay user gets a 10-digit account number, so money can be sent by
-- account number as well as by phone — the way a real bank works. Numbers are
-- issued from a sequence (never reused), are unique, and look like a NUBAN
-- (ten digits, non-zero leading digit).

-- 1) A dedicated sequence issues the numbers. Starting at 2.1 billion keeps
--    every number ten digits without any zero-padding, and leaves the lower
--    range free for any future reserved prefixes.
CREATE SEQUENCE IF NOT EXISTS agbede_account_seq
  START WITH 2100000000
  INCREMENT BY 1;

-- 2) The account number lives on the user. Nullable for now so the backfill
--    below can fill it without a table rewrite inside the same transaction.
ALTER TABLE users
  ADD COLUMN account_number VARCHAR(10);

-- 3) Backfill every existing account with the next number.
UPDATE users
   SET account_number = nextval('agbede_account_seq')::text
 WHERE account_number IS NULL;

-- 4) New accounts are issued a number automatically, so registration needs no
--    change and can never forget to assign one.
ALTER TABLE users
  ALTER COLUMN account_number SET DEFAULT nextval('agbede_account_seq')::text;

ALTER TABLE users
  ALTER COLUMN account_number SET NOT NULL;

-- 5) A number identifies exactly one account; this index also serves lookups.
CREATE UNIQUE INDEX idx_users_account_number ON users(account_number);
