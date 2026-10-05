# AgbedePay — Databases, SQL & PostgreSQL (Phase 3 lesson)

> Read this top to bottom. It's the class you need before we build the schema.

---

## 1. The big picture

A **database** is just a store of data that lives on a server, organised into
**tables**. PostgreSQL is one specific *database management system* (DBMS) — like
MySQL is another. We chose PostgreSQL because of one killer feature: **ACID
transactions**, which we need to move money safely.

To talk to PostgreSQL we use **SQL** (Structured Query Language).

---

## 2. Tables, rows, columns

Think of a **table** as a spreadsheet:

```
users table
 | id (PK) | full_name   | phone        | pin_hash | status   | created_at          |
 |---------|-------------|--------------|----------|----------|---------------------|
 | 1       | Ada Obi     | 08012345678  | 0x9f3a…   | ACTIVE   | 2026-09-13 09:00:00 |
 | 2       | Chidi Nwosu | 08087654321  | 0x71c0…   | ACTIVE   | 2026-09-13 09:05:00 |
```

- A **row** = one record (one user).
- A **column** = one field of that record (their phone, their name…).
- Each column has a **type**: `VARCHAR(120)` is text up to 120 characters;
  `BIGINT` is a big whole number; `TIMESTAMPTZ` is a date+time with timezone;
  `BOOLEAN` is true/false; `UUID` is a globally unique identifier.

---

## 3. Five verbs you will live in

```sql
-- Read rows. * means "all columns".
SELECT * FROM users;

-- Read specific columns and filter with WHERE ($1 is the first parameter later).
SELECT full_name, phone FROM users WHERE phone = $1;

-- Add a row.
INSERT INTO users (full_name, phone, pin_hash)
VALUES ('Ada Obi', '08012345678', '0x9f3a...');

-- Change existing rows.
UPDATE users SET status = 'ACTIVE' WHERE phone = $1;

-- Remove rows.
DELETE FROM sessions WHERE expires_at < now();
```

> ⚠️ **Golden rule:** we NEVER build these queries by gluing user input into the
> string. We always write `$1, $2…` placeholders and pass the values separately.
> That single habit kills the most common database attack (SQL injection).

---

## 4. Primary keys & foreign keys (relationships in disguise)

- **Primary key (PK):** the column that *uniquely* identifies a row. PostgreSQL
  guarantees no two rows share it. In AgbedePay every table has a `UUID` PK — a
  long random id like `a5f0c9b2-...` that nobody can guess.
- **Foreign key (FK):** a column that *points to another table's PK*. This is how
  you say "this wallet belongs to that user":

```
wallets                                           users
| id | user_id (FK -> users.id) | balance_minor |  | id | full_name |
|----|--------------------------|---------------|  |----|-----------|
| 1  | 2                        | 5000000       |→ | 2  | Chidi     |
```

`wallets.user_id = 2` **is** the relationship: it's a 1-to-1 (one user → one
wallet) because we also put `UNIQUE` on it.

Useful relationships:
- **1-to-many:** one user creates many `transactions` (as sender/receiver).
- **many-to-many:** users *send to* other users — encoded through the
  `transactions` table holding two FK columns (`sender_wallet_id`,
  `receiver_wallet_id`).

To combine two tables by their FK we use a **JOIN**:

```sql
SELECT u.full_name, w.balance_minor
FROM users u
JOIN wallets w ON w.user_id = u.id
WHERE u.phone = $1;
```

---

## 5. Constraints & indexes — rules PostgreSQL enforces for us

**Constraints** are the database *refusing* to accept bad data. If we trust them,
bugs (and attackers) bounce off:

- `NOT NULL` — the column must have a value.
- `UNIQUE` — no duplicate values (only one account per phone).
- `CHECK (balance_minor >= 0)` — money can never go negative. PostgreSQL blocks
  the UPDATE that would break the rule.
- `REFERENCES … ON DELETE CASCADE` — deleting a user also cleans up their rows.

**Indexes** make lookups fast. Without an index, PostgreSQL scans every row; with
`CREATE INDEX idx_users_phone ON users(phone)`, a `WHERE phone = $1` goes straight
to the right row. Each table gets an index on every foreign key (for fast JOINs)
and on columns we filter by a lot.

---

## 6. Money is an integer, never a float

`0.1 + 0.2` in JavaScript is `0.30000000000000004`, not `0.3`. Computers can't
store most decimal fractions exactly. So in AgbedePay a naira is never a decimal:

> ₦1 = **100 kobo**, stored as the whole number `100` in `balance_minor`.
> To read a balance: `balance_minor / 100`. To display: `(balance_minor / 100).toFixed(2)`.

₦205,000.00 stored as `BIGINT 20500000` — safe to add and subtract with zero
rounding surprises. Our code never uses floats for money. Ever.

---

## 7. The schema (what we actually build)

```
users 1────1 wallets                     users 1───N transactions (sender/receiver)
users 1───N savings_goals                users 1───N savings_transactions
savings_goals 1───N savings_transactions
users 1───N otp_codes                    users 1───N sessions
users 1───N audit_logs
```

Each migration file below creates one piece. `001_core` holds a shared trigger
that auto-updates `updated_at` on any row.

| Migration | Table | Storing | Notable rules |
|---|---|---|---|
| 002_users | users | the account | phone UNIQUE, status CHECK, pin_hash TEXT (never plaintext) |
| 003_wallets | wallets | where money lives | one wallet/user (UNIQUE user_id), balance_minor ≥ 0, currency NGN |
| 004_transactions | transactions | immutable money records | idempotency partial unique index, type/status CHECK, amount > 0 |
| 005_savings | savings_goals, savings_transactions | goals + deposits | target > 0, reference UNIQUE |
| 006_otp_codes | otp_codes | verification codes | stores only the SHA-256 hash |
| 007_sessions | sessions | login tokens | token_hash UNIQUE (only hash), expiry/revoke |
| 008_audit_logs | audit_logs | security/finance events | JSONB metadata, never secrets |

---

## 8. Exercise checklist — you know you're ready when you can…

1. Explain a table/row/column in your own words.
2. Write `SELECT full_name FROM users WHERE phone = $1` from memory.
3. Say what `UNIQUE` and `CHECK` do and why the database — not the app — must enforce them.
4. Explain why `balance_minor` is an integer and how to convert ₦ to kobo.
5. Point at the row in `wallets` that "belongs to" a row in `users` and say which
   column is the foreign key.