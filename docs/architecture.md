
# AgbedePay — System Architecture (Phase 1)

> Pay. Save. Grow.
> This document is the *design blueprint*. We approve it together before writing code.

---

## 1. Big Picture

AgbedePay is a **monolithic (single-app) full-stack application**, split into two
clear halves inside one project:

- **backend/** — a Node.js + Express REST API. All business rules, money logic,
  and database access live here. This is the *only* thing that talks to PostgreSQL.
- **frontend/** — plain HTML + CSS + vanilla JS. It *only* renders pages and calls
  the backend API. It never holds money logic and never touches the database.

```
Browser (frontend)  --HTTP/JSON-->  Express API (backend)  --SQL/params-->  PostgreSQL
```

Why not split them onto totally separate servers yet? For an MVP, one project with
two folders is far easier to run, test, and learn from. If AgbedePay grows, the
backend API can be scaled separately without changing the frontend code.

---

## 2. Technology Decisions (and WHY)

| Area            | Choice                                  | Why                                                              |
|-----------------|-----------------------------------------|------------------------------------------------------------------|
| Frontend        | HTML5 + CSS3 + Vanilla JS (ES6+)        | You asked for it; no framework to learn before the fundamentals. |
| Backend         | Node.js + Express.js                    | Huge ecosystem, JavaScript on both sides, perfect for learning.  |
| Database        | PostgreSQL via `pg` driver              | True source of truth; real ACID transactions (see §6).           |
| SQL style       | Parameterized queries (`$1`, `$2`, ...) | Prevents SQL injection — user input never becomes SQL code.      |
| Money           | `INTEGER`/`BIGINT` minor units (kobo)   | Floats can't exactly represent money (0.1 + 0.2 ≠ 0.3).          |
| PIN hashing     | Argon2id (via `argon2`)                 | Slow, memory-hard, current best practice for hashing secrets.    |
| OTP / session   | SHA-256 hash of code/token in DB        | We only store *hashes*; a leaked DB never leaks usable codes.    |
| IDs             | UUID (v4)                               | Un-guessable; stops IDOR attacks where users guess each other's ids. |
| Migrations      | Custom lightweight runner + SQL files   | No heavy ORM; you write real SQL and learn it.                   |
| API tests       | Node's built-in test runner + supertest | Zero extra framework; runs with `npm test`.                      |

---

## 3. Folder Structure

```
agbedepay/
├── frontend/            # Static site (served by Express in dev)
│   ├── index.html
│   ├── pages/           # login.html, register.html, dashboard.html, ...
│   ├── css/
│   ├── js/              # api.js (fetch wrapper), auth.js, ui.js, pages/...
│   ├── components/      # reusable header/nav/modals (reused via JS)
│   └── assets/          # logo, icons
│
├── backend/
│   ├── src/
│   │   ├── config/      # env loading, db pool
│   │   ├── database/
│   │   │   ├── migrations/   # 001_initial.sql, 002_...
│   │   │   └── seeds/        # dev seed data
│   │   ├── routes/      # define URLs -> controllers
│   │   ├── controllers/ # HTTP layer: read request, call service, send response
│   │   ├── services/    # business logic: money transfer, savings, providers
│   │   ├── models/      # pure SQL access functions (queries)
│   │   ├── middleware/  # auth, rate limit, validation, error handler
│   │   ├── validators/  # request shape checks
│   │   ├── providers/   # MockAirtimeProvider, MockBillProvider, MockOTP, PaymentProvider
│   │   ├── utils/       # money helpers, crypto helpers, ref generator
│   │   └── app.js       # builds the Express app
│   └── server.js        # starts the server
│
├── tests/
│   ├── unit/            # money, validators, crypto utils
│   ├── integration/     # backend + real PostgreSQL
│   └── api/             # full HTTP endpoint tests
│
├── docs/                # this file + others
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── LICENSE
```

The layered rule (services → models) matters:
- A **route** only maps an HTTP verb+URL to a controller.
- A **controller** only parses input and formats responses.
- A **service** holds business rules (e.g., "balance must cover amount").
- A **model** is the *only* place SQL is written.

No business logic in routes, no SQL in controllers, no money logic in the frontend.

---

## 4. Frontend Architecture

- **Multi-page** (MPA) — one HTML file per screen, not a single-page app. Simpler
  to learn, works without a framework, and each page has a clear URL.
- `js/api.js` is a tiny `fetch()` wrapper that:
  - attaches the session cookie / auth header,
  - parses JSON, normalizes errors into readable messages,
  - redirects to login on 401.
- A shared `js/ui.js` handles: form validation display, toast notifications,
  number/currency formatting (using **integers in kobo** from the API).
- **Balances are NEVER computed or trusted on the frontend** — the backend is the
  only place a balance exists.
- Accessibility: semantic `<main>/<nav>/<form>`, `<label for>`, `aria-*` attributes,
  visible focus, and mobile-first CSS.

---

## 5. Backend API Architecture (REST)

Base URL: `/api`

```
Auth:        POST /api/auth/register
             POST /api/auth/login
             POST /api/auth/logout
             POST /api/auth/forgot-pin
             POST /api/auth/reset-pin
User:        GET  /api/users/me
             PATCH /api/users/me
Wallet:      GET  /api/wallet
Transactions: POST /api/transactions/send              (by phone or AgbedePay account no.)
             POST /api/transactions/account/verify/agbede (payee name lookup)
             GET  /api/transactions            (paginated)
             GET  /api/transactions/:id
             GET  /api/transactions/:id/receipt
Receive:     GET  /api/payments/receive        (account + QR payload)
Savings:     POST /api/savings/goals
             GET  /api/savings/goals
             GET  /api/savings/goals/:id
             POST /api/savings/goals/:id/deposit
Airtime:     POST /api/airtime/purchase
Bills:       GET  /api/bills/providers
             POST /api/bills/pay
Security:    POST /api/security/change-pin
             GET  /api/security/sessions
             DELETE /api/security/sessions/:id
Health:      GET  /health
```

**Consistent response envelope** — every endpoint returns the same shape:

```json
// success
{ "success": true, "data": { ... } }

// failure
{ "success": false, "message": "Insufficient wallet balance", "code": "INSUFFICIENT_FUNDS" }
```

Errors never expose stack traces, SQL text, or secrets. `code` values are stable
strings the frontend can branch on (e.g., `INVALID_PIN`, `OTP_EXPIRED`, `RATE_LIMITED`).

Pagination: `?page=1&limit=20`; API returns `data.items`, `data.page`, `data.total`.

---

## 6. PostgreSQL Architecture (the heart of AgbedePay)

### First, the mental model

A **database** is a collection of **tables**. A **table** is like a spreadsheet:
**rows** are records and **columns** are fields. SQL is the language we use to
*ask questions and make changes*:

```sql
SELECT * FROM users;                 -- show every user
SELECT phone FROM users WHERE id = $1;  -- one user's phone
INSERT INTO users (phone) VALUES ($1);  -- add a user (never done with raw input!)
UPDATE wallets SET balance_minor = $1 WHERE id = $2;
DELETE FROM sessions WHERE expires_at < now();
```

A **primary key (PK)** uniquely identifies a row. A **foreign key (FK)** is a
column that points at another table's PK — that is how *relationships* are stored.
Indexes make searches fast. Constraints are rules PostgreSQL *enforces* so bad
data can't get in.

### Why PostgreSQL (not a file or MySQL)

Sending money means changing **several rows at once** (debit sender, credit
receiver, write the record). If the app crashes halfway, your money system breaks.
PostgreSQL gives us **transactions** with ACID guarantees — atomic, consistent,
isolated, durable. That is *the* core tool for a payments product.

### ERD (relationships in words)

```
users 1───1 wallets          (a user owns exactly one wallet)
users 1───N transactions     (a user's wallets appear as sender/receiver)
users 1───N savings_goals
users 1───N savings_transactions
users 1───N sessions
users 1───N otp_codes
users 1───N audit_logs
savings_goals 1───N savings_transactions
wallets N───N wallets  via transactions (sender_wallet_id -> receiver_wallet_id)
```

### Tables

**users** — who you are.
| column | type | notes |
|---|---|---|
| id | UUID PK | generated by server |
| full_name | VARCHAR(120) NN | |
| phone | VARCHAR(20) UNIQUE NN | login identity |
| email | VARCHAR(255) UNIQUE NULL | optional |
| pin_hash | TEXT NN | Argon2id hash, never plaintext |
| status | VARCHAR(20) NN | ACTIVE \| SUSPENDED \| DISABLED |
| is_verified | BOOLEAN NN | true from account creation |
| created_at / updated_at | TIMESTAMPTZ | |

**wallets** — where money lives.
| column | notes |
|---|---|
| id UUID PK | |
| user_id UUID FK→users UNIQUE | one wallet per user |
| currency CHAR(3) | 'NGN' |
| balance_minor BIGINT NN | kobo (₦1 = 100 kobo) |
| status | ACTIVE \| FROZEN |

**transactions** — the immutable record of every money movement.
| column | notes |
|---|---|
| id UUID PK | |
| reference VARCHAR(64) UNIQUE | human-readable, e.g. `TXN-...` |
| idempotency_key VARCHAR(128) | UNIQUE partial index for transfers |
| sender_wallet_id UUID FK NULL | null for some types |
| receiver_wallet_id UUID FK NULL | |
| amount_minor BIGINT NN CHECK > 0 | |
| currency CHAR(3) | |
| type | TRANSFER \| SAVINGS_DEPOSIT \| AIRTIME \| BILLS \| REVERSAL |
| status | SUCCESS \| PENDING \| FAILED \| REVERSED |
| narration / failure_reason | |
| created_at / completed_at | |

**savings_goals** — name, target amount, target date, current amount, status.
**savings_transactions** — every deposit into a goal (goal_id FK, user_id FK,
amount_minor, type DEPOSIT, reference UNIQUE, status).
**otp_codes** — phone, purpose (REGISTRATION/FORGOT_PIN), code_hash (SHA-256),
expires_at, attempts, consumed_at. We store only a hash so a stolen database
doesn't give away codes.
**sessions** — user_id, token_hash (SHA-256 of the bearer token given to the
browser), expires_at, revoked_at, device info. Logout / PIN reset revokes rows.
**audit_logs** — user_id, action, entity_type/id, metadata JSONB, ip, user_agent,
created_at. Immutable record of security & financial events. Never contains secrets.

### The critical enforcement points

- `UNIQUE(phone)` → no duplicate accounts.
- `UNIQUE(wallets.user_id)` → no double wallets.
- `CHECK (amount_minor > 0)`, `CHECK (balance_minor >= 0)` → no negative/zero money.
- Partial `UNIQUE` index on `(sender_wallet_id, idempotency_key) WHERE type='TRANSFER'`
  → the backbone of idempotency (§8).
- Every FK gets an index → fast `JOIN`s.

---

## 7. Authentication & Authorization Architecture

**Authentication** = proving *who you are* (login).
**Authorization** = checking *you are allowed to do this* (per-request).

Flow:
1. **Register** → validate input → check phone unused → create user
   (`ACTIVE`, verified) with Argon2id-hashed PIN → create wallet → sign the user
   in immediately (no OTP / verification step).
2. **Login** → rate limit (max 5 fails / 15 min per phone+IP) → verify phone+pin →
   create opaque session token (256-bit random) → store its SHA-256 hash in
   `sessions` → send token to the browser.
3. **Auth middleware** reads the token on every protected endpoint, looks up the
   session hash, checks expiry/revocation, attaches `req.user` + `req.session`.
   Ownership is ALWAYS derived from the server-side session — never from a
   client-supplied `user_id`.

OTPs are still used for **PIN reset** and the optional **login security code**:
the code is generated on the server, only its SHA-256 hash is stored, and it
expires after 15 min / 5 attempts. The mock provider prints `[DEV/MOCK OTP]` to
the server console; the interface allows a real SMS provider (Termii) to be
swapped in via `SMS_PROVIDER` with no code changes.

Token delivery: an `httpOnly` + `SameSite=Strict` cookie for MVP (or
`Authorization: Bearer` header for cross-origin API use). The frontend never reads
or stores the token in JS, which shrinks XSS theft.

Password/PIN reset: phone → OTP (`FORGOT_PIN`) → new PIN (re-hashed) → **revoke
all existing sessions** so stolen sessions die with the old PIN.

---

## 8. Financial Transaction Architecture (the crown jewel)

### The rule

**A money transfer is NEVER `balance = balance - amount`.** Money movement is a
single PostgreSQL transaction, or it doesn't happen at all.

```sql
BEGIN;

-- 1. Lock the sender's wallet row (FOR UPDATE) so nobody else edits it concurrently
SELECT balance_minor FROM wallets WHERE id = $sender FOR UPDATE;

-- 2. Validate balance & lock receiver
SELECT id FROM wallets WHERE id = $receiver FOR UPDATE;   -- recipient must exist

-- 3. Debit sender
UPDATE wallets SET balance_minor = balance_minor - $amt WHERE id = $sender;

-- 4. Credit receiver
UPDATE wallets SET balance_minor = balance_minor + $amt WHERE id = $receiver;

-- 5. Immutable record
INSERT INTO transactions (..., status = 'SUCCESS');

-- 6. Audit log
INSERT INTO audit_logs (...);

COMMIT;   -- all-or-nothing
-- on any error: ROLLBACK   (no partial state, no double spending)
```

### Concurrency & double-spending

Two transfers for the same sender at the same time: `SELECT ... FOR UPDATE` makes
the *second* one wait until the first commits, then the second sees the fresh,
reduced balance. Negative balance becomes impossible.

### Idempotency

The client sends a unique `Idempotency-Key` with each transfer. Inside the DB
transaction we `INSERT` the transaction with that key; the partial unique index
rejects a duplicate, we catch the conflict, and return the **original** transaction
result. Twice-clicked = charged once.

### Ledger design (honest MVP choice)

A full double-entry ledger (two or more entries per movement, credits=debits)
is the gold standard for banks. For the MVP we use the **`transactions` table as a
simplified ledger**: one row per movement recording sender side and receiver side,
with balances maintained atomically inside the same DB transaction. Successful rows
are **immutable**; corrections always happen as new `REVERSAL` rows, never by
editing history. We document that full double-entry is a later upgrade.

---

## 9. Wallet, Savings, Airtime, Bills

- **Wallet** — created at registration, one per user. `GET /api/wallet` returns
  the balance read from the DB (in kobo) plus a formatted NGN display string.
- **Savings deposit** — one DB transaction: lock wallet, validate balance, debit
  wallet, increment goal's `current_amount_minor`, insert `savings_transactions`
  row and a `transactions` row `type=SAVINGS_DEPOSIT`. Progress = current/target.
- **Airtime & Bills** — built behind provider **interfaces**:

```
AirtimeService  --calls-->  AirtimeProvider   (interface)
                                └── MockAirtimeProvider   (today)
                                └── RealProvider (later, no app rewrite)

BillPayService  --calls-->  BillProvider (interface)
                                └── MockBillProvider
```

The mock returns a fake provider reference (e.g., `MOCK-AIRTIME-...`), clearly
labelled as a simulation, and the purchase still debits a real wallet DB row and
writes a real transaction record. Providers are swappable — we never hard-code
vendor logic into services.

---

## 10. Security Architecture

- Parameterized SQL everywhere (no SQL injection by construction).
- Argon2id for PINs; SHA-256 for OTP codes & session tokens (they're random +
  short-lived, so the fast-but-no-plaintext tradeoff is right; we explain this
  when we implement it).
- `helmet` security headers; `SameSite=Strict` cookies; CSRF protection for
  state-changing requests.
- Rate limits: login, OTP (forgot PIN / login code), send money, register.
- Input validation on **every** endpoint (types, lengths, phone format, amounts,
  ids) — backend validation is security, frontend validation is just UX.
- Audit logging of security + financial events (never PINs/OTPs/tokens).
- Error responses never leak internals. Secrets live only in `.env` (committed
  `.env.example` holds placeholders).
- Authorization middleware on every protected route; ownership derived from the
  session, not from request bodies.

---

## 11. Testing Strategy

- **Unit** — money conversions (naira↔kobo), validation functions, OTP utils,
  formatting helpers.
- **Integration** — backend + a real PostgreSQL test DB: register→wallet→transfer
 →balance, savings deposit, idempotency, concurrent transfers.
- **API** — full HTTP tests with supertest: registration, login, OTP, send money,
  history, airtime, bills, and the security cases (invalid PIN, expired OTP,
  duplicate request, unauthorized).
- Key scenarios we WILL prove with tests: success, insufficient balance, invalid
  recipient, invalid PIN, duplicate idempotency-key, expired OTP, unauthorized,
  concurrent transfer (no double spend), reversal.

---

## 12. Deployment Strategy

For the MVP: keep it simple and cheap.

- PostgreSQL: a managed cloud provider (e.g. Render / Neon) so backups and
  security are handled for us.
- Backend + frontend: one Node service (Express serves the built frontend) on a
  platform like Render/Railway, or a small VPS with nginx.
- HTTPS via the platform/certbot. `.env` holds production secrets; migrations run
  automatically at deploy; logs structured; backups scheduled.
- Mock providers remain labeled `MOCK` in production UI — never real-money claims.

---

## 13. Development Roadmap (the phases we'll do together)

1. **Phase 1** — Architecture (THIS). Approve → move on.
2. **Phase 2** — Project foundation: Node/Express server, config, health check,
   folder skeleton. *Learn: Node, Express, package.json, env vars, HTTP flow.*
3. **Phase 3** — PostgreSQL: teach SQL + build schema, migrations, seeds.
4. **Phase 4** — Backend fundamentals: routes, controllers, services, models,
   validation, error handling.
5. **Phase 5** — Authentication: register, OTP, login/logout, sessions, forgot
   PIN, auth middleware.
6. **Phase 6** — Wallet.
7. **Phase 7** — Financial transactions (ACID, concurrency, idempotency, reversal).
8. **Phase 8** — Savings.
9. **Phase 9** — Mock airtime & bills.
10. **Phase 10** — Frontend screens (one group at a time).
11. **Phase 11** — Security hardening review.
12. **Phase 12** — Testing suite.
13. **Phase 13** — Deployment.

Every phase ends with: build → explain → test → **you review → you approve → next**.

---

## 14. Decisions you should be able to defend after this phase

1. Why do we store money as integer kobo instead of float naira?
2. Why is money movement wrapped in a SQL transaction with `FOR UPDATE`?
3. Why do we store hashes of OTPs/tokens instead of the values?
4. Why does the frontend never decide a balance?
5. Why is `idempotency_key` unique per sender?
6. Why is the balance read from the DB, not from the client?
7. Why are providers behind an interface?
8. What does "authorization derives from the session, not the request body" mean?