# AgbedePay — Authentication & Authorization (Phase 5 lesson)

> This is the most important security phase. Read it, then trace each concept
> back to the files we just built.

## 1. Two different questions

- **Authentication** = "Who are you?" (proving it at login)
- **Authorization** = "May you do THIS?" (checked on every protected request)

In AgbedePay: `login` authenticates you; `requireAuth` authorizes each request,
deriving *your* identity **from the session server-side** — never from a
`user_id` you send in a request body. That's what stops IDOR attacks (accessing
someone else's data by changing an id).

## 2. Why Argon2id for the PIN

A hash is a one-way function: same input → same output, but you can't reverse it.
If the database leaks, `pin_hash` is useless to an attacker. We chose
**Argon2id** (memory-hard, deliberately slow) because casual hashing (MD5, fast
SHA-256) lets attackers brute-force 6-digit PINs trivially. Slow hashing makes
guessing expensive. PINs are *never* stored or logged in plaintext, and have their
own private lookup (`findByPhoneWithPin`) so the hash can never appear in a
profile response.

## 3. OTP — one-time, short-lived, hash-stored

- Generated on the server, **hashed with SHA-256**, only the hash is stored.
  (Fast hash is acceptable here — codes are random 6-digit values, expire in
  15 min, and raise an error after 5 attempts.)
- One code = one use: `consumed_at` is set on success.
- Resend has a 60 s cooldown.
- The provider is behind an interface (`otpProvider.js`). Which provider runs is
  decided by `SMS_PROVIDER` in `.env` — **no code changes needed to switch**:

  | `SMS_PROVIDER` | Provider       | What happens                                              |
  |----------------|----------------|-----------------------------------------------------------|
  | `mock` (default) | `mockOtpProvider` | prints `[DEV/MOCK OTP] …` to the server console; the UI never claims an SMS was sent |
  | `termii`       | `termiiOtpProvider` | sends a **real SMS** through Termii (see below)        |

  Unknown values fall back to `mock`, so a typo never breaks registration.

### Configuring & testing the Termii provider

1. Create a Termii account and (if your "from" is an alphanumeric sender ID)
   submit it for approval. Copy your API key and base URL from the dashboard
   (Settings → API token; the base URL is routed to your region — v4 accounts
   look like `https://v4.api.termii.com`).
2. In `.env` (already git-ignored — never commit credentials):
   ```
   SMS_PROVIDER=termii
   TERMII_API_KEY=<your api key>
   TERMII_SENDER_ID=<approved sender id>
   TERMII_BASE_URL=https://v4.api.termii.com
   ```
   From the project root, restart the API: `npm run dev`.
   - **No key / missing sender ID** → server refuses to start with a clear
     message (`SMS_PROVIDER=termii requires TERMII_API_KEY and TERMII_SENDER_ID`).
3. Trigger a code: register → the code is delivered to the phone as a real SMS.
   - The number is converted to international format (`08012345678` →
     `2348012345678`), and the **`dnd` (transactional) route** is used — Termii
     requires this for OTP codes (the generic route doesn't deliver to DND
     numbers and blocks after time restrictions).
   - The SMS reads: *"AgbedePay: your verification code is XXXXXX. Use it to
     complete your AgbedePay account registration. It expires in 15 minutes.
     Do not share it."*
4. Test in dev without burning a real SMS: keep `SMS_PROVIDER=mock` and watch
   the console for `[DEV/MOCK OTP] …`.

**Security:** the API key is read from the environment and **never logged**
(even on failure). Termii's own error wording is logged and returned to the
client as a generic `502 SMS_SEND_FAILED`; recipient numbers are logged masked
(`234801**********`). Termii is configured for production by setting
`NODE_ENV=production` per the rest of the app.

## 4. Sessions — the browser never keeps a secret it can read

When you log in the server creates an opaque random token, stores only
`sha256(token)` in `sessions`, and hands the token to the browser in an
**httpOnly cookie**:

```
httpOnly  → JavaScript can't read it, so an XSS bug can't steal it
sameSite: strict → the browser only sends it on same-site requests → CSRF protection
secure (prod) → it only travels over HTTPS
```

Logout revokes the row (`revoked_at`). Reset-PIN revokes **all** sessions, so old
tokens die instantly.

## 5. Rate limiting = brute-force defence

```
register: 10/hour per IP
login:      5 per 15 min per phone+IP
OTP:        5 per 15 min per phone+IP
```
The login limiter keys on **phone + IP**, so one attacker smashing one phone gets
cut off, but a classroom sharing a Wi-Fi (same IP) is not blocked. Production
upgrade: Redis-backed store shared across servers (a note for Phase 13).

## 6. The generic error trick

`forgot-pin` always answers *"If an account exists, a code was issued."* — whether
or not it did. And login verifies a fixed fake Argon2 hash when the phone doesn't
exist, so the *time* a response takes doesn't reveal which phones are registered.
Both stop account enumeration.

## 7. Files that matter

```
providers/otpProvider.js + mockOtpProvider.js   provider interface + mock
providers/termiiOtpProvider.js + index.js       real SMS provider + SMS_PROVIDER switch
services/otpService.js                          expiry, attempts, cooldown
services/authService.js                         register/login/logout/forgot/reset
middleware/requireAuth.js                       the authorization gate
middleware/rateLimit.js                         3 tuned limiters
utils/crypto.js                                 argon2id + sha256 + random
models/otpCodes.js, sessions.js, audit.js       SQL for the auth tables
validators/authSchemas.js                       per-endpoint input rules
routes/authRouter.js, userRouter.js             wiring
```

## 8. Exercise — prove you understand

Open the sequence for one request in your head, then verify it live:

```
POST /api/auth/login  { phone: ..., pin: ... }
1. rate limiter      → counted
2. validate(loginSchema) → shape + PIN rules
3. controller        → login({...})
4. service           → load user w/ pin_hash → argon2.verify
5. session row       → token (random) → store sha256 only
6. httpOnly cookie   → set on response
```

Live re-check (server running): `npm run dev`, then
1. Log in, open `http://localhost:3000/api/users/me` with the cookie → 200.
2. Open it in a private window without the cookie → 401.
3. Try `{"phone":"08012345678","pin":"000000"}` → invalid PIN rule (400);
   try a correct-format wrong pin 5× → 429 on the 6th.

Explain out loud why the DB can't prove your PIN even if it's stolen.