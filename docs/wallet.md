# AgbedePay — Wallets, Balance & Money (Phase 6 lesson)

## 1. What a wallet is in AgbedePay

A wallet is ONE row in the `wallets` table, created automatically at
registration. It does not "hold cash" — it holds a NUMBER:

```
wallets:  id | user_id (FK) | currency | balance_minor | status
```

- one wallet per user (`UNIQUE(user_id)`),
- `balance_minor` = integer **kobo**. ₦105,000 = `10500000`. No floats, ever.
- `CHECK (balance_minor >= 0)` means PostgreSQL itself refuses a negative balance.

## 2. Why the frontend can never be trusted with a balance

The frontend lives in the *user's browser*. Anything the browser sends can be
edited by the user (devtools, scripts, a client-side patch, a man-in-the-middle
proxy). If the frontend "decided" the balance:

1. the attacker edits the JSON to show `balance: 99999999` — now the UI lies,
2. worse, if money math ran in the browser, they could send a transfer worth
   more than they own.

So the rule is: **every balance in the UI is a fresh value read from the
database on that request.** The API always returns `balanceMinor` (integer kobo)
and `balanceNgn` (a *formatted string* produced server-side) — there is nothing
to edit that changes what the backend believes.

## 3. Ownership — where does "whose wallet" come from?

`GET /api/wallet` requires a session. The route calls
`requireAuth`, which places the *authenticated* user on `req.user`.
The controller then passes `req.user.id` to the service.

There is **no `:userId` parameter** on the route at all — so a user cannot send
`?userId=ada` and read Ada's wallet. Ownership is fixed server-side. This is the
IDOR defence again, now applied to money.

## 4. Wallet status

- `ACTIVE` — normal.
- `FROZEN` — the owner can still READ their balance (it's their money view),
  but every money-moving operation (Phase 7+) calls
  `assertWalletActive()` first and refuses with `403 WALLET_FROZEN`.
- `CLOSED` — terminal.

## 5. Money formatting

```js
// utils/money.js
minorToNaira(10500000)   // "105000.00"   (string, safe to display)
formatNaira(10500000)    // "₦105,000.00"
```

Converting to NGN happens ONLY for display, server-side, at the edge. All
stored values and all arithmetic (Phase 7) stay in integer kobo.

## 6. Exercise

Answer these out loud before moving to Phase 7:
1. If I set `balance_minor = 100` in the DB, what do we display (and how is it
   stored)? Why is `100` not `1.00` the internal value?
2. Why is `balanceNgn` built server-side instead of in the frontend?
3. What would an attacker need to change in a request to make the server debit
   someone else's wallet? (Follow `GET /api/wallet` end-to-end and prove the
   answer is "they can't — there is no parameter to change".)
4. What does `assertWalletActive()` protect us from in Phase 7?