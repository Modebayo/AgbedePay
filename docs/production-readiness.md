# Production readiness

Status of the ride / driver / cargo / payments workstream. Read this alongside
[`deploy.md`](./deploy.md), which covers the mechanics of shipping and 502s.

_Last reviewed during the Phase 6–9 build (payments, security, docs, admin console)._

## Go / no-go

| Area | State | Notes |
| ---- | ----- | ----- |
| Wallet ledger, escrow, idempotency | **Ready** | Pre-existing, unchanged in spirit; new flows reuse it. |
| Ride booking + DB-backed fares | **Ready** | Falls back to a deterministic mock route with no Maps key. |
| Driver dashboard | **Ready (schema-gated)** | Needs migration `030`. |
| Agbede Cargo quotations | **Ready (schema-gated)** | Needs `033`, `035`. |
| Payments (Paystack) | **Ready (schema-gated)** | Needs `034`; disabled-not-mocked without keys in prod. |
| Security hardening | **Ready** | See below. |
| Automated tests | **200 pass / 31 suites** against a throwaway DB | Without one: **167 pass / 4 expected fails** (171 tests; the DB-guarded API suites). |
| Migrations `028`–`036` | **APPLIED** | Backed up, applied to the target DB and verified. See below. |
| Admin console (`/api/admin`, `admin.html`) | **Ready (schema-gated)** | Overview degrades per-module; queues need `030`/`033`/`034`. |

**Verdict: technically ready.** Migrations are applied and the schema is sound;
what remains is key configuration and manual QA on a staging target.

## Migrations (applied)

Migrations `028_virtual_accounts` through `036_agbede_account_numbers` are
committed and **applied and verified** on the target Render database. Before the
change a full backup was taken (`pg_dump`), `npm run db:migrate` applied `028`–`036`
with **no** `db:seed`, and the result was checked: `schema_migrations` lists
`001`–`036`, `users.role` exists (all rows `CUSTOMER`), `users.account_number` is
backfilled unique with no nulls (`2100000000`–`2100000004`), the new
`driver_profiles`/`cargo_quotes`/`payment_transactions` tables are present, `/health`
reports `db.connected: true`, and the unauthenticated routes return `401`.

Caveat: that database has **no ADMIN and no DRIVER** account (all five users are
`CUSTOMER`), so the admin console and driver flows are not reachable there until a
driver applies or an admin is promoted.

> **Rehearsed on a clean database too.** All 36 migrations (including `028`–`036`)
> were applied to a fresh PostgreSQL 18 database in one run and the seed completed
> without error, so the SQL itself is sound. The full API suite (200 tests) was
> run against it.

Migrations are tracked in `schema_migrations`, run one-file-per-transaction, and
are safe to re-run. There is no `db:seed` in production. Apply on staging first,
then production.

## Security posture

Fixed in this pass:

- **Rate limits** added to the money-moving routes that lacked them:
  `POST /api/transactions/requests/:id/pay`, `POST /api/transactions/:id/reverse`
  (per-user send-money limiter) and `POST /api/auth/pin` (dedicated 5/15-min
  PIN-change limiter).
- **`trust proxy`** set to `1`, so rate limiters key on the real client IP behind
  Render/nginx instead of bucketing every client together.
- **Dispatch delivery code** no longer sprayed across responses. It is revealed
  only to the booking owner, only on the single-booking detail, and only while a
  rider is engaged (`RIDER_ASSIGNED`/`PICKED_UP`/`IN_TRANSIT`) — never in list
  responses, never before assignment, never after the trip ends.
- **`/api/dev/*`** is mounted only when `NODE_ENV !== "production"`.
- **Payment webhooks** are signature-verified against the raw body and
  de-duplicated in `payment_events`; settlement is idempotent via the ledger key
  `pay:<reference>`.
- **Error-handler multer collision** fixed. The central handler mapped *any*
  error whose code starts `LIMIT_` to a 400 "That upload was rejected." — which
  also matched our own KYC code `LIMIT_EXCEEDED`. Every "you've hit your daily
  send limit" response was therefore reported as a 400 upload error with the
  wrong message. The mapping is now gated on `err.name === "MulterError"`, so
  domain errors keep their real status and message. Pinned by
  `tests/unit/transfer-account.test.js`.

Known, accepted:

- Mock OTP prints live codes **in development only** (`SMS_PROVIDER=mock`).
- Because the customer holds the delivery code by design, the legacy
  customer-driven `/advance` DELIVER endpoint still works. The customer UI no
  longer calls it (transitions are driver-driven); it remains for the mock demo.
- `npm audit` last reported **0 vulnerabilities**; it could not be re-run during
  this build (no network). Re-run before go-live.

## Admin console

Every `/api/admin/*` route sits behind `requireAuth` + `requireRole("ADMIN")`
mounted once at the router, so no endpoint can forget the gate. The console
pairs a cross-module **overview** with four action queues:

- `GET /api/admin/overview` — users, wallet balance held, ledger volume, rides,
  dispatch, drivers, cargo, payments, support, plus a recent-activity feed.
  Each section is read behind a missing-table/column guard, so an un-migrated
  module degrades to zeros instead of failing the whole page.
- `GET /api/admin/drivers` + `PATCH /api/admin/drivers/:id` — approve / suspend /
  re-queue a driver (suspension also forces them offline).
- `GET /api/admin/cargo` + `PATCH /api/admin/cargo/:id` — price a request and
  move it through its lifecycle.
- `GET /api/admin/support` + `POST /api/admin/support/:id/reply` — answer /
  resolve a ticket.
- `GET /api/admin/payments` + `POST /api/admin/payments/:reference/reconcile` —
  re-check a straggling PENDING payment.

Every mutation is written to `audit_logs` with the acting admin as the actor, and
customer/driver-affecting actions also post to their notification tray. The UI is
`frontend/pages/admin.html` (+ `js/pages/admin.js`), reachable from an "Admin"
tile that appears on the dashboard only for the `ADMIN` role. There is no new
migration — the console reads existing tables.

`tests/api/admin.test.js` exercises the write paths end to end (approve a driver,
resolve a ticket, price a cargo request). It caught a real plan-time bug: a
parameter bound both to a `VARCHAR` column and a `'LITERAL'` comparison made
Postgres reject the statement with *inconsistent types deduced for parameter* —
fixed with explicit `::varchar` casts in `driverModel.setStatus` and
`supportTickets.reply`.

## Migrations reference

New in this workstream:

| Migration | What it adds |
| --------- | ------------ |
| `028_virtual_accounts` | Dedicated funding accounts. |
| `029_agent_accounts` | Withdrawal agent accounts. |
| `030_driver_domain` | `users.role`, `driver_profiles`, `driver_offers`, booking driver columns. |
| `031_settlement` | `DRIVER_EARNING` ledger type, `driver_earnings`. |
| `032_pricing_rules` | DB-backed fare rules. |
| `033_cargo_quotes` | Cargo quotation requests (+ `reference`). |
| `034_payments` | `payment_transactions`, `payment_events`. |
| `035_cargo_notifications` | `CARGO` notification type. |
| `036_agbede_account_numbers` | `users.account_number` (10-digit, from a dedicated sequence) + unique index. |

## Manual QA (no headless browser available)

Automated coverage is `node --test`; the API suites need a throwaway database.
The following require a human because there is no DOM test harness:

1. Fund wallet → Card → redirected to gateway → returned → wallet credited,
   receipt links to a `SUCCESS` ledger row.
2. Book a ride → driver (seeded `33333333…`) accepts → advances → customer sees
   read-only live status (no auto-advance).
3. Start a dispatch → driver marks delivered with the customer's code → escrow
   released minus commission.
4. Submit a cargo quotation → confirm it appears under "My requests".
5. From a CUSTOMER account, open `/driver.html` → the "Apply to drive" form
   renders → submit vehicle details → the account becomes a PENDING driver (new
   profile + role flip) and the page shows "Application under review". The
   "Drive" tile only appears for the DRIVER role; a second apply returns 409.
6. Sign in as the seeded ADMIN (`44444444…`) → the "Admin" tile appears → the
   overview renders → approve the pending driver, price a cargo request, reply to
   a ticket, reconcile a PENDING payment. A non-admin hitting `/admin.html` sees
   the "Admins only" state and receives 403 from every `/api/admin/*` call.
7. Transaction detail (`transaction.html?id=…`): the counterparty shows the
   account **name over the number**; the left corner has **Report issue** (files a
   support ticket — verify it appears in Help) and the right corner has **Share
   PDF** (native share sheet, or print → Save as PDF); there is **no** reverse
   button. The dashboard/`transactions.html` lists show the counterparty name over
   the number. On the airtime page the network picker shows operator logos.

## Recommended next increments

1. Run the manual QA above on a staging target (migrations are already applied on
   the current target; that DB needs an ADMIN/DRIVER seeded if those flows are to
   be exercised there).
2. Re-run `npm audit` with network access.
3. Add a DOM/headless test harness so the new transaction/receipt/airtime UI is
   covered beyond the static wiring tests.
