# AgbedePay — Backend Fundamentals (Phase 4 lesson)

> Read this while following the code in `backend/src`. Every concept maps to a
> real file you now own.

---

## 1. What the backend actually is

The frontend is what you *see*; the backend is the program that **decides**.
It guards data, applies rules, and talks to PostgreSQL. An **API** (Application
Programming Interface) is the contract between the two: the frontend sends an
HTTP request, the backend returns JSON.

## 2. HTTP methods — verbs with meaning

| Verb | Meaning | Example use |
|---|---|---|
| GET | "give me data" (never changes anything) | list users, wallet balance |
| POST | "create something" | register, send money |
| PATCH | "update part of something" | rename a user, change profile |
| PUT | "replace something whole" | (rarely used in our API) |
| DELETE | "remove something" | revoke a session |

**Status codes** — the backend's answer tone:
`200` ok · `201` created · `400` bad input · `401` unauthenticated ·
`403` not allowed · `404` not found · `422` business-rule failure · `500` server crash.

## 3. Routes → controllers → services → models (the layers)

```
URL (e.g. GET /api/dev/users/08012345678)
   │  route   → matches the request to a controller       (routes/devRouter.js)
   │  validate→ rejects bad input before any logic runs   (validators/validate.js)
   │  controller → thin: reads request, calls service, responds (controllers/userController.js)
   │  service  → decides rules ("profile includes the wallet") (services/userService.js)
   │  model    → the ONLY place SQL lives                  (models/users.js, wallets.js)
   ▼
PostgreSQL
```

Why split so thinly? Each layer answers one question and can be tested alone.
If a bug is about *money math* it's in services. If it's about *SQL* it's in
models. If it's an HTTP problem it's in controllers/routes. You never hunt
through one 500-line mega-file.

## 4. Middleware — a chain each request walks through

Express handle = a pipeline. `app.use(...)` appends a step. Order matters:

```
helmet → cors → json → health/dev/API routes → /api 404 → static files → catch-all → errorHandler
```

Each middleware either answers the request (sends a response) or calls `next()`
to continue. Our `validate()` is middleware: if input is bad it responds 400
immediately; otherwise `next()` to the controller.

Two middleware you must know:
- `asyncHandler` (`utils/errors.js`) — Express 4 won't catch your async errors;
  this wrapper forwards rejections to the error handler.
- `errorHandler` (`middleware/errorHandler.js`) — EVERY error lands here and
  becomes the same JSON shape: `{ success:false, message, code, details }`.

## 5. Validation is a security control

The frontend pretties up errors. The **backend** refuses bad data — that's the
real gate. Our `validators` check:
- types (`string`, `int`) — never trust what arrives,
- shape (Nigerian `phone` regex, `uuid`),
- ranges (`min`, `max`, `minLen`, `maxLen`).

If validation fails → `400 VALIDATION_ERROR` with per-field `details`. Notice it
runs BEFORE any DB call, so garbage never touches the database.

## 6. Parameterised queries (non-negotiable)

```js
// models/wallets.js
await query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]);
```

The user input goes in as a **value**, positionally (`$1`), never spliced into
the SQL string. Even if an attacker sends `' or '1'='1`, PostgreSQL treats it as
data. This is our SQL-injection defence.

## 7. Never leak the pin_hash

`users` table has `pin_hash`, but `models/users.js` deliberately **never selects
it**. Public responses only include public fields. The auth code (Phase 5) will
have its own private query — the hash has exactly one job: verify a PIN.

## 8. The request↔response flow we just built (trace it with curl!)

`GET /api/dev/users/08012345678`
1. Express parses URL → hits `GET /users/:phone` (validated by `schemas.phoneParam`)
2. Controller `getUserByPhone`
3. Service: user exists? → build public profile
4. Model: `SELECT ... FROM users WHERE phone=$1` and wallet JOIN
5. Controller returns `{ success, data: { profile } }`
6. Response printed with `"balanceMinor":10500000, "balanceNgn":"₦105,000.00"`

## 9. Exercise — add your own endpoint (the real test of understanding)

Add `GET /api/dev/savings/:phone` that lists that user's savings goals with
progress (`current / target * 100`). Steps:

1. `models/savings.js`: `listByPhone(phone)` with a JOIN `users u` → `savings_goals g`.
2. `services/savingsService.js`: shape each goal + add `progressPercent`.
3. `controllers/savingsController.js`: call service, respond.
4. Route in `devRouter.js` with `validate(schemas.phoneParam, "params")`.
5. `curl http://localhost:3000/api/dev/savings/08012345678` and expect
   `{ "name":"New Laptop", "progressPercent": 12.5 }`.

Use this exact layered pattern everywhere you add a feature — it's how every
remaining phase will be built.