# Phase 7 — Financial Transactions

> The crown jewel. Sending money the right way: ACID, row locks, idempotency,
> and honest reversals.

---

## 1. What we built

| Endpoint | What it does |
|---|---|
| `POST /api/transactions/send` | Send money to any wallet by phone **or** 10-digit AgbedePay account number. Requires session + `Idempotency-Key` + your PIN. |
| `POST /api/transactions/account/verify` | NUBAN name enquiry for a bank account (the "who am I paying?" preview). |
| `POST /api/transactions/account/verify/agbede` | Resolve an AgbedePay holder's name from their account number **or** phone (transfer preview). |
| `GET /api/transactions` | Your history, paginated (`?page=&limit=`), filterable (`?status=&type=`). |
| `GET /api/transactions/:id` | One transaction, with sender/receiver names. Ownership-checked. |
| `GET /api/transactions/:id/receipt` | Customer-facing receipt (completed transactions only). |
| `POST /api/transactions/:id/reverse` | Reverse a successful transfer (sender or receiver, with PIN). **Backend-only** — the customer UI no longer surfaces a reverse action (see §1.1). |

New files:

```
backend/src/middleware/requireIdempotencyKey.js   header gate for money moves
backend/src/validators/transferSchemas.js         request shapes
backend/src/services/transferService.js           business rules (who/why/own-wallet)
backend/src/controllers/transferController.js     thin HTTP layer
backend/src/routes/transferRouter.js              URL wiring
backend/src/models/transferModel.js               THE money movement (ACID + locks)
backend/src/utils/reference.js                    TXN-… / RVS-… reference generator
```

### AgbedePay account numbers

Every user gets a **10-digit** `users.account_number` (migration `036`, drawn from
a dedicated sequence starting at `2100000000`). It is the wallet-holder's public
identifier — like a bank account number, but for AgbedePay. Two consequences:

- **Send by account number** — `POST /transactions/send` accepts either
  `recipientPhone` (11 digits) or `recipientAccount` (10 digits); the service
  rejects a request that supplies both or neither. Everything downstream (limits,
  row locks, idempotency, ledger) is identical to a phone transfer.
- **Name preview** — `POST /transactions/account/verify/agbede` resolves the
  holder's display name from either identifier so the sender *sees* who they're
  paying before confirming; the backend re-resolves at send time, so a tampered
  client can't invent a payee. (The bank tab uses the sibling
  `/transactions/account/verify` NUBAN lookup.)

The frontend exposes the user's own number on the dashboard (tap to copy) and, on
the transfer page, accepts a phone **or** the account number with live name sync.
The bank picker is a searchable combobox over the bank directory.

### 1.1 Transaction detail & receipt (frontend)

The transaction detail page (`frontend/pages/transaction.html`) shows the
counterparty with their **account name on top and their number underneath**, and
carries two corner actions:

- **Report issue** (left) — opens a modal that files a real support ticket via
  `POST /api/support/tickets`, with the category derived from the transaction
  (`WITHDRAWAL` for cash-outs, `PAYMENT` otherwise) and the subject
  `Issue with <reference>`. This *replaced* the old reverse-transfer button and
  modal: a customer who thinks something is wrong talks to a human instead of
  self-reversing, while the `/reverse` endpoint stays available to support.
- **Share PDF** (right) — links to `receipt.html`, whose action uses the native
  share sheet (`navigator.share`) and falls back to the print dialog
  (`Print → Save as PDF`) where the Web Share API is unavailable.

The recent-transaction lists on the dashboard and `transactions.html` use the
same helper (`ui.txCounterparty`) so they, too, show the person's name over their
number rather than a raw narration. On the airtime page the network picker
renders operator **logos** (`ui.networkLogo`) instead of names.

---


## 2. Why a transfer must be ONE database transaction (ACID)

Sending money touches **four things**:

1. debit the sender's wallet,
2. credit the receiver's wallet,
3. write the `TRANSFER` row,
4. (in future) the audit row.

If the process crashed between step 1 and step 2, the sender would be poorer and
the receiver no richer — money destroyed out of thin air.

PostgreSQL's **transaction** fixes this:

```
BEGIN;                       -- everything after this is provisional
   ... debit sender ...
   ... credit receiver ...
   ... insert transaction row ...
COMMIT;                      -- DONE — all of it, or (on any error) ROLLBACK
```

- `COMMIT` publishes *all* the changes together — a reader never sees half of a transfer.
- `ROLLBACK` throws away *everything* since `BEGIN` — no partial state.
- **Durability**: once committed, the changes survive a crash/power loss.

If `COMMIT` is missing, PostgreSQL automatically rolls back when the connection
closes. That's the safety net.

---

## 3. Why `FOR UPDATE` row locks (the double-spend battle)

Two `send` requests for the same sender arrive at the *same instant*:

```
Request A:  read balance → 100,000    Request B:  read balance → 100,000
            balance = 90,000                        balance = 90,000        ← BOTH think they can afford it!
```

Both would debit 10,000 → balance 90,000 written twice → ₦10,000 created.

`SELECT … FOR UPDATE` stops this. The first request to touch a wallet row
**locks** it; the second request's `SELECT … FOR UPDATE` **waits** at that row.
When the first transaction commits, the lock releases, and the second request —
still *inside its own transaction* — now sees the **fresh** balance (90,000),
which is correct.

In `executeTransfer` we lock both wallets in one statement, **ordered by id**:

```sql
SELECT id, balance_minor, status FROM wallets
 WHERE id = ANY($1::uuid[])
 ORDER BY id
 FOR UPDATE
```

Why `ORDER BY id`? If transfer A locks (sender, receiver) and transfer B locks
(receiver, sender) then A waits on B while B waits on A → **deadlock** (PostgreSQL
will kill one with an error). Ordering by id means every request locks the same
*small* id first, so waiting is always one-directional — deadlock-free.

## 4. The authoritative checks run UNDER the locks

Rules in the app layer are convenience; the rules that matter run **after** the
locks are held, inside the transaction:

- both wallets exist,
- both are `ACTIVE` (not FROZEN),
- sender balance ≥ amount.

```
lock wallets  →  re-check  →  debit/credit  →  insert  →  COMMIT
```

A cheaper check may have run earlier, but only the in-transaction check is truth.

---

## 5. Idempotency — "I clicked send twice"

A double-click, or a network retry after a timeout, must **not** charge twice.

- The client sends a unique `Idempotency-Key` header on every `send`.
- The `transactions` table has a **partial unique index**:

```sql
CREATE UNIQUE INDEX uq_transactions_sender_idempotency
  ON transactions (sender_wallet_id, idempotency_key)
  WHERE type = 'TRANSFER';
```

- The *first* insert with a key succeeds.
- A *second* insert with the same `(sender, key)` violates the index → PostgreSQL
  raises `23505`. We catch it inside `executeTransfer` and tell the service to
  **fetch and return the stored outcome** instead of moving money again.

The response includes `"replayed": true` so the client knows nothing new happened.

Database is the only fair referee for this: two servers (or two retries) cannot
both claim a key in memory, but the unique index is shared and reliable.

Note: FAILED attempts also record their `idempotency_key`, so a retry after a
failure returns the same failed outcome — the key stays "claimed" either way.

## 6. The ledger and REVERSAL — we never rewrite history

A full bank ledger is **double-entry**: every movement writes ≥2 rows so
debits always equal credits. For the MVP the `transactions` table acts as our
simplified ledger: one row per movement recording both sides, with balances kept
consistent inside the same transaction.

Successful rows are **immutable**. If money needs to come back:

1. A **new** `REVERSAL` row is written (Chidi → Ada, identical amount).
2. The **original** row is flagged `status = 'REVERSED'`.

The original's numbers are never edited. Two concurrent reversals can't both win:
`executeReversal` locks the *original row* `FOR UPDATE`, re-checks `status =
'SUCCESS'` under the lock, and the second reversal therefore sees `REVERSED` and
fails with `TRANSFER_NOT_REVERSIBLE`.

## 7. Re-authentication

Every money-moving action re-verifies the user's own PIN. The session proves
*who* you are; the PIN proves you *actually meant* to move money. Received as a
cleartext field in one request, verified against the Argon2id hash — never logged.

## 8. Security choices

- Ownership is always the **session's** wallet (`req.user.id` → wallet) — a client
  can't view or reverse someone else's transaction (`404` either way).
- Amounts stay **integer kobo** end-to-end; formatting to `₦` strings only at the edge.
- Every transfer/reversal writes an **audit** entry (no secrets).
- `send` is rate-limited to **5/min per user**; PIN gates every transfer.

---

## What you should be able to defend now

1. Why is a transfer inside `BEGIN … COMMIT` (all-or-nothing)?
2. Why does the second concurrent request *wait* — and why `ORDER BY id`?
3. Why does `Idempotency-Key` protection live in the **database**, not in JS memory?
4. Why do FAILED attempts also claim their idempotency key?
5. Why is a reversal a NEW row instead of editing the original?
6. Why re-verify the PIN on every money movement?

## Exercise

Open two terminals, log in as Ada and Chidi (`08012345678` / `08087654321`, PIN
`482913`), and from Ada send ₦10,000 with the **same** `Idempotency-Key` twice.
Confirm: one `TRANSFER` row, one debit, `replayed: true` the second time. Then
list Chidi's wallet before/after.

Reversal is now API-only (no customer UI action), so exercise it with the
endpoint directly: `POST /api/transactions/:id/reverse` as Chidi (PIN `482913`)
and watch both balances return to their starting values while the original shows
`REVERSED`. From the UI, the replacement path is **Report issue**, which files a
ticket rather than moving money.