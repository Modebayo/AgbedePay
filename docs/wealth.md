# AgbedePay — Wealth (investments, treasury, retirement)

## 1. What Wealth is

Wealth is the part of AgbedePay where money is *not* spent — it is held. Eight
pages, one shared kit, one instrument catalogue.

| Page | File | What it does |
|---|---|---|
| My Wealth | `wealth.html` | The hub. Totals, allocation, holdings, retirement strip, navigation. |
| Stocks | `wealth-stocks.html` | Buy/sell real NGX equities. Live prices. |
| Funds | `wealth-funds.html` | Money market, balanced, equity funds. |
| Bonds | `wealth-bonds.html` | FGN treasury bills and bonds, with maturity dates. |
| Pension | `wealth-pension.html` | Long-term retirement savings. |
| Retirement Goal | `wealth-retirement.html` | Projection: are you on track to stop working? |
| Portfolio | `wealth-portfolio.html` | Every position, value and gain. |
| Investment History | `wealth-history.html` | Every buy and sell, paginated and filtered. |

## 2. The data model

```
wealth_instruments   the catalogue. unit_price_minor (kobo), yield_pct,
                     risk_level, is_live, maturity_date (nullable DATE)
wealth_holdings      one row per customer per instrument.
                     units_minor — FOUR decimals, scaled by 100_000
wealth_orders        every buy and sell, with idempotency_key
wealth_goals         retirement goals, one ACTIVE per user
```

`wealth_goals` arrived in migration `024_wealth.sql`; `maturity_date` and its
partial index arrived in `025_bond_maturity.sql`.

The instrument catalogue lives in its own module,
`backend/src/database/wealthCatalogue.js`, not inside `seed.js`. It is
reference data: it depends on no user, no wallet and no transaction. That
matters because `seed.js` is deliberately guarded — it refuses to re-run once a
wallet's balance has drifted from the arithmetic it expects, since re-seeding a
database with real activity would leave users, wallets and transactions
inconsistent with each other. A dev database that has been used therefore cannot
be re-seeded, and if it predates the Wealth section it has no instruments at
all, leaving Funds, Bonds and Pension permanently empty with no safe fix.

So the catalogue is applied on its own:

```bash
npm run db:migrate
npm run db:seed:wealth     # idempotent; touches no user data
```

It refreshes `maturity_date` on re-run, because that is the one time-relative
value, and it deliberately does **not** overwrite `unit_price_minor` — once the
live feed has written a real quote, re-applying the catalogue must not snap the
price back to the seeded figure.

### The units scale, which will trip you up

`units_minor` is **not** minor units. It is units multiplied by 100,000, because
a share can be bought in fractions smaller than a kobo. So:

```
15 units at ₦1,066.70
  units_minor = 15 × 100_000     = 1_500_000
  value_minor = 1_500_000 × 106670 / 100_000
               = 1_600_050
```

Asserting `value === units * price` is wrong by a factor of 100,000. It is in
`tests/api/wealth.test.js` with a comment, because it is the single most
misleading thing in this module.

## 3. The honesty rule

This is the most important section of this document, and it is the reason the
section is built the way it is.

**Live and indicative are different things, and the interface says which.**

`wealth_instruments.is_live` is `TRUE` only for stocks, where a real NGX feed
provides prices. Funds, bonds and pension products have no keyless public feed;
their `yield_pct` is an **indicative** rate and `is_live = FALSE`. Every page
that lists a non-live class prints a caveat saying so, and the three class pages
do not render a day-change percentage — a fund's NAV moves once a day and a
treasury bill's indicative price does not move at all, so a change column would
sit at 0.00% and read as a broken product.

**The retirement projection never shows one number.**

`retirementService.projectGoal` returns a projection under two assumptions:

- `projectedMinor` — at the assumed annual return,
- `projectedAtZeroReturnMinor` — at **0%**, i.e. savings alone.

It also returns `status` and `statusAtZeroReturn`, and:

```
statusNeedsGrowth = status !== "ACHIEVED" && statusAtZeroReturn === "BEHIND"
```

When that is true, the page shows a warning block stating how much of the
outcome is growth rather than savings, in naira. A customer who only ever saw
the optimistic figure would have been shown a sales pitch, not a plan. The
assumption is a user-controlled slider, defaulted to 12% and capped at 30%, and
moving it re-runs the maths **on the server** so the browser can never disagree
with the API about the answer.

The same warning is repeated on the Wealth hub, because the one warning that
matters most should not be the thing you have to navigate to find.

## 4. The projection maths

`backend/src/services/retirementService.js`. Pure functions, no I/O, fully unit
tested in `tests/unit/retirement-projection.test.js`.

```js
// An ordinary annuity, compounded monthly.
futureValueMinor({ potMinor, monthlyMinor, annualPct, months })

// The payment that reaches `targetMinor` under the same assumptions.
requiredMonthlyMinor({ potMinor, targetMinor, annualPct, months })
```

Both run twice — once at the assumed return, once at 0% — so the two verdicts
can never be derived from different arithmetic.

The starting pot is the customer's **live portfolio value** when they hold
anything (`potSource: "PORTFOLIO"`), and the goal's manually entered amount
otherwise (`"MANUAL"`). The page tells them which is in use, because "you are
₦2.1m away from retirement" means something different depending on whether that
figure is real.

Age comes from `users.date_of_birth` when present, otherwise from the value
claimed when the goal was created. The response reports which via `ageSource`,
and the page says so, because a projection built on a stale age is quietly wrong.

### Money types

Ledger amounts are integer kobo. Projections are the one exception: compound
interest is not exact in binary floating point, so the maths runs in floats and
is rounded **once**, at the API boundary, with `Math.round`. Never round
mid-calculation.

## 5. One controller, three pages

Funds, Bonds and Pension are the same page with different copy. Not similar —
the same page.

`frontend/js/wealth-kit.js` holds `CLASS_PAGES`, the three personas side by
side. `frontend/js/pages/wealth-browse.js` reads the class off
`<body data-wealth-class>` and looks up its persona. It never branches on which
page it is running in.

The payoff: a fix to the buy flow, the empty state or the search lands on all
three at once, and the three copies cannot drift apart over a year of
maintenance. When the Pension ETF class ships it is one more entry in
`CLASS_PAGES` plus a new shell file — no new controller.

## 6. Why `wealth-kit.js` exists

Wealth is the first part of this app that is eight pages needing the same
sub-navigation, the same gain/loss formatters, the same "is this price live?"
badge and — above all — the same buy/sell confirmation flow with its PIN. Written
as eight independent scripts that would be eight copies of a PIN modal, and they
would drift apart the first time the badge wording changed.

So: one kit, thin controllers. The rules the kit obeys are the app-wide ones:

- balances and values are **formatted by the backend** (`valueNgn` alongside
  `valueMinor`); nothing computes a portfolio value in the browser,
- every interpolated value goes through `ui.escapeHtml`,
- every money-moving action carries a fresh `Idempotency-Key` and a PIN.

## 7. Security

- `requireAuth` on every Wealth route. No `:userId` parameter exists anywhere in
  the module, so a caller cannot read someone else's portfolio by editing a URL.
  The IDOR defence is structural, not a check.
- `listInstruments` scopes `held_units_minor` to the caller. There is no
  portfolio-wide "18 people hold this" aggregate, which would leak other
  customers' positions and tell the asker nothing.
- Orders are rate limited to 5 per user per minute and require an
  `Idempotency-Key` and a correct 6-digit PIN, verified before any wallet debit.
- Retirement goal endpoints move no money, so they take no PIN, no rate limit
  and no idempotency key. A goal is a plan, not a transaction.
- Goals are validated for **coherence before** the one-active-goal conflict
  check, so a request that is both malformed and conflicting gets told what is
  wrong with the request rather than a `409` that hides a bug the caller can fix.
- `DELETE /api/wealth/retirement/:id` soft-closes (`status = 'CLOSED'`). The row
  stays, so a closed goal is still auditable.

## 8. Dates

`maturity_date` is a Postgres `DATE`, which `pg` returns as a JS `Date` pinned
to **local** midnight. Calling `.toISOString()` on it converts to UTC and shifts
the date a day backwards for every user east of Greenwich — a bond maturing on
the 30th rendering as "matures on the 29th", for every user of a Nigerian
product.

So `wealthService.toIsoDate` reads the local calendar fields and formats them by
hand, and `daysToMaturity` compares in UTC on both sides. Both are covered by
`tests/unit/wealth-dates.test.js`, including the regression case.

The seed writes maturities as `dateInYears(n)` — relative to the moment the
catalogue is applied — for the same reason. A hard-coded maturity would make
"1.2 years to go" quietly wrong every time it was re-applied, and a bond page
that lies about how long is left is worse than no bond page at all.

## 9. The API

All routes require a session. Money is kobo on the wire, formatted strings
alongside.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/wealth/overview` | Totals, allocation, top holdings, recent orders. |
| GET | `/api/wealth/portfolio` | The caller's positions only. |
| GET | `/api/wealth/instruments` | Optional `?class=STOCK\|FUND\|BOND\|PENSION`. |
| GET | `/api/wealth/instruments/:id` | 404 `INSTRUMENT_NOT_FOUND`. |
| GET | `/api/wealth/history` | `?page`, `?limit`, `?type`. |
| POST | `/api/wealth/orders/buy` | PIN + `Idempotency-Key` + rate limited. |
| POST | `/api/wealth/orders/sell` | PIN + `Idempotency-Key` + rate limited. |
| GET | `/api/wealth/retirement` | Goal, projection, assumptions. `?returnPct=`. |
| POST | `/api/wealth/retirement` | Create. 409 if one is already active. |
| PATCH | `/api/wealth/retirement/:id` | Whitelisted fields only. |
| DELETE | `/api/wealth/retirement/:id` | Soft-close. |

### Running the tests

```bash
DATABASE_URL="postgres://postgres@localhost:5432/agbedepay_test" npm test
```

The API suites need a disposable database, and refuse to start without one — they
read seeded data and spend wallet balance.

`tests/api/wealth.test.js` spends all five of Ada's order-rate-limit calls, so
the wrong-PIN case lives in `tests/api/wealth-pin.test.js` — a separate process,
therefore a separate rate-limit bucket. Adding a sixth order call to the first
file fails with `429` and looks like a product bug.

`node --test tests/unit/` does not work on this Windows setup (it resolves the
directory as a module), which is why `npm test` uses a glob. Name individual
files if you want to run one.
