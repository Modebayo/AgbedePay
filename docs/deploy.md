# Deployment

How to get this running on a server, and how to diagnose it when it isn't.

## Required on every deploy

```bash
npm install          # installs dependencies, including multer for avatar uploads
npm run db:migrate   # applies pending SQL migrations
npm start            # node backend/server.js
```

All three matter. Running an older `node_modules` or skipping `db:migrate` has
taken the whole site down before — see "Why the site went down" below.

### Environment

| Variable        | Required | Notes                                              |
| --------------- | -------- | -------------------------------------------------- |
| `DATABASE_URL`  | yes      | Postgres connection string. Used by the app pool.  |
| `PORT`          | yes      | Port the proxy forwards to. Defaults to `3000`.     |
| `NODE_ENV`      | no       | Set to `production` so internals are never returned.|
| `SMS_PROVIDER`  | no       | `mock` (default, prints to console) or `termii`.   |
| `APP_BASE_URL`  | prod     | Public origin, e.g. `https://agbedepay.com`. Used for payment callbacks. |
| `GOOGLE_MAPS_BROWSER_KEY` | no | Browser key (referrer-restricted). Absent ⇒ mock routes. |
| `GOOGLE_MAPS_SERVER_KEY`  | no | Server key (IP-restricted, Routes API enabled). |
| `PAYSTACK_SECRET_KEY` | yes (prod) | Paystack secret key. Absent in prod ⇒ payments disabled, never mocked. |
| `PAYSTACK_PUBLIC_KEY` | no  | Paystack public key.                               |
| `FLUTTERWAVE_SECRET_KEY` | alt | Only if using Flutterwave instead of Paystack. |
| `FLUTTERWAVE_WEBHOOK_SECRET` | alt | The "Secret hash" set in the Flutterwave dashboard. |
| `PLATFORM_COMMISSION_BP` | no | Default trip commission in basis points; `1500` = 15%. |

Payments pick their provider from the environment (see `providers/paymentProvider.js`):
Paystack if its secret key is set, else Flutterwave, else the **mock** in
development, else an **unavailable** provider that fails every call with
`PAYMENTS_UNCONFIGURED`. Production never silently falls back to the mock — that
would credit wallets for free.

#### Payment webhooks

Register the webhook in the gateway dashboard (they do not auto-configure):

- Paystack → `{APP_BASE_URL}/api/payments/webhook`
- Flutterwave → `{APP_BASE_URL}/api/payments/webhook/flutterwave`

The handler verifies the provider signature against the **raw** request body
(captured in `app.js`), de-duplicates replays in `payment_events`, then settles
the wallet through the normal `FUNDING` ledger path keyed by `pay:<reference>` —
so a retried webhook and a client-side verify both credit at most once.

`app.listen(env.port)` binds all interfaces, so `0.0.0.0` and `::` both accept
connections. Your proxy must forward to the same `PORT` the app is listening on
— a mismatch is the most common cause of a 502.

### Migrations are not automatic

`npm start` does not run migrations. A fresh deploy against an existing database
needs `npm run db:migrate` explicitly, or the app will start and then throw on
any query touching a new column. Migrations are tracked in `schema_migrations`
and are idempotent, so re-running is safe.

`npm run db:setup` (`db:create` + `db:migrate` + `db:seed`) is for a **brand new
database only**. Never run it against a database with real data — `db:seed`
truncates.

### Staging cutover checklist

The ride / driver / cargo / payments work introduces migrations `028`–`035`, and
the AgbedePay account-number feature adds `036`. They are additive and idempotent,
but until they are applied the affected endpoints degrade (they return errors
rather than corrupt anything).

```bash
# 1. Apply pending migrations (prints [skip] for applied, [ ok ] for pending).
npm run db:migrate

# 2. Confirm the app boots clean.
curl -fsS "$APP_BASE_URL/health" | jq .

# 3. Smoke-test the new surfaces while signed in (cookie jar):
#    - GET  /api/geo/config             → { enabled, region }
#    - POST /api/driver/apply           → 201 (any signed-in user; PENDING driver, flips role)
#    - GET  /api/driver/me              → 403 unless the user is a DRIVER
#    - POST /api/cargo/requests         → 201 quotation lead
#    - POST /api/payments/initiate      → { authorizationUrl } (mock in dev)
#    - GET  /api/admin/overview         → 403 unless the user is an ADMIN
#    - GET  /api/users/me               → profile now carries accountNumber
#    - POST /api/transactions/account/verify/agbede  → resolve a payee by account/phone
#    - POST /api/transactions/send      → accepts recipientAccount (10 digits) OR recipientPhone
```

Roll forward only. Each migration runs in its own transaction; a failure aborts
that file and leaves earlier ones applied. There are no down-migrations — to undo
a schema change, write a new migration.

> Do **not** point `DATABASE_URL` at the production database to "test" a
> migration. Use a staging database restored from a recent backup.

### Admin console

The operator console mounts at `/api/admin` and the UI is `/pages/admin.html`.
Every route is gated at the router by `requireAuth` + `requireRole("ADMIN")`, so
there is no per-route gate to forget. It needs **no environment variables** and
adds **no migration** — it reads existing tables.

```bash
# Signed in as an ADMIN (see below):
curl -fsS -b cookies.txt "$APP_BASE_URL/api/admin/overview" | jq '.data.users'
```

- Role comes from `users.role` (migration `030`). Until `030` is applied,
  `requireRole` reads a missing column and the admin routes return `500`, exactly
  like the driver routes — apply migrations first.
- The dev seed creates an ADMIN (`44444444-…`); on production, promote a user to
  ADMIN deliberately (there is no sign-up path to the role).
- The overview reads each module behind a missing-table guard, so a partially
  migrated database renders zeros for the un-migrated sections rather than a
  broken page. The four action queues (drivers / cargo / support / payments)
  still require their own tables.

## Why the site went down (502 on every route)

Worth recording, because the failure mode was invisible.

`backend/src/middleware/uploadAvatar.js` had a top-level `import multer from
"multer"`. That module sits in the startup import chain:

```
backend/server.js → src/app.js → routes/userRouter.js → controllers/userController.js → middleware/uploadAvatar.js
```

Node loads that entire graph before `app.listen()` runs. On a server whose
`node_modules` predated the `multer` dependency, the import threw
`ERR_MODULE_NOT_FOUND` during module loading. The process exited before binding
the port, so the reverse proxy had nothing upstream to talk to and returned
**502 for every route** — including `/health`, and including routes with nothing
to do with avatars.

**A profile-picture feature took the entire site offline.**

Two structural fixes now prevent a repeat:

1. **No route-scoped dependency is imported at startup.** `uploadAvatar.js`
   resolves `multer` lazily via `createRequire` on first use. If it is missing,
   the server still boots, every other route still serves, and only avatar
   upload returns `501 UPLOAD_DEPENDENCY_MISSING` with an instruction to run
   `npm install`.

2. **`/health` probes optional dependencies and says so.** It never throws, and
   it reports missing packages rather than only "ok".

## Diagnosing a 502

Work down this list — it is ordered by how often each is the cause.

```bash
# 1. Is the process even running, and did it crash on boot?
node backend/server.js
```

A crash on startup prints the reason. A silent hang means it started; note the
port it bound.

```bash
# 2. Does it serve locally?
curl -i http://127.0.0.1:$PORT/health
```

`200` with `"status":"ok"` means Node is fine and the problem is the proxy or the
network. `503` means the database is unreachable — check `DATABASE_URL` and that
Postgres is running and accepting connections. `degradedFeatures` in the response
means a feature dependency is missing; the rest of the app still works.

```bash
# 3. If local works but the proxy 502s, compare ports.
echo "app listens on: $PORT"
```

`PORT` must match what the proxy forwards to. Check the proxy's own error log
too — it distinguishes "connection refused" (wrong port, process dead) from
"upstream timeout" (app hung).

```bash
# 4. Confirm the database has every migration.
npm run db:migrate   # prints [skip] for applied, [ ok ] for pending
```

## Persistent file storage

Uploaded profile pictures are written to `backend/storage/avatars/` on the local
disk, and `backend/storage/` is gitignored. On a single-server deploy that is
fine. Two things to know if you move to more than one instance or to an
ephemeral filesystem:

- **Ephem disks lose pictures.** On a platform with a disposable container
  filesystem (Heroku-style, some container runtimes), a restart wipes the
  directory and every user falls back to initials. Mount a persistent volume, or
  move to object storage.
- **Multiple instances need shared storage.** Each instance currently reads its
  own disk, so an upload handled by instance A is invisible to instance B. Only
  one instance can serve `/api/users/avatar` correctly.

Both are contained: only `uploadAvatar.js` touches the filesystem, so moving to
S3 or similar means rewriting `persistAvatar`, `deleteAvatar` and
`resolveAvatarPath` and nothing else.

## Dependency health

`npm audit` reports **0 vulnerabilities**.

`ip-address` — pulled in transitively by `express-rate-limit` — previously
carried a moderate advisory: a subnet allowlist check that could compare IPv4 and
IPv6 addresses as if they shared an address space, plus an unbounded-length parse
that could stall the process. `express-rate-limit@8.7.0` is already the latest
release, so the fix had to come from the transitive package. `package.json` pins
it via an override:

```json
"overrides": {
  "ip-address": "^10.7.3"
}
```

An override rather than a direct dependency, because nothing in this codebase
imports `ip-address` — it is `express-rate-limit`'s internal concern, so the pin
is scoped to exactly that and does not add a package the app appears to depend
on. Verified afterwards: `ipKeyGenerator` still normalises IPv4 and IPv6, and
the login limiter still returns 429 on the sixth attempt.

## Tests

```bash
DATABASE_URL="postgres://postgres@localhost:5432/agbedepay_test" npm test
```

**Always point tests at a throwaway database.** The suites create, update and
delete real rows, and some call money-moving endpoints. The API test files carry
a safety rail that refuses to start unless the URL looks like a test database,
and it self-corrects a stale `.env` by re-executing with the test URL.

Note that `.env` is loaded by `backend/src/config/env.js` and `dotenv` does not
override variables already in the environment, so an explicit `DATABASE_URL=...`
on the command line wins.