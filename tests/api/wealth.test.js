// tests/api/wealth.test.js — Wealth API contract.
//
// Zero dependencies: node:test + node:assert, the same runner `npm test` already
// uses. The app is imported and bound to an ephemeral port in-process, so there
// is no server to start and nothing to tear down beyond the pool.
//
// RUNS AGAINST A DISPOSABLE DATABASE. The suite refuses to start unless
// DATABASE_URL looks like a test database, because half of these assertions
// depend on seeded data and three of them spend real wallet balance.
//
// RATE LIMIT BUDGET: sendMoneyLimiter allows 5 order calls per user per minute.
// This file spends 5 of Ada's, which is the entire budget. The wrong-PIN case
// would be the 6th, so it lives in tests/api/wealth-pin.test.js, which is a
// SEPARATE process with its own fresh bucket — the same arrangement the order
// lifecycle tests use. If you add an order call here without moving one out,
// the next one fails with RATE_LIMITED and it will look like a product bug.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../backend/src/app.js";
import { pool } from "../../backend/src/config/db.js";

// ---- Safety rail -----------------------------------------------------------

const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  throw new Error(
    `Refusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database. ` +
      `Wealth tests read seeded data and spend wallet balance.`
  );
}

// ---- Tiny HTTP client ------------------------------------------------------

let base = "";
let cookie = "";
let server = null;

/** Performs a request, carrying the session cookie once we have one. */
async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth && cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (pair.startsWith("agbedepay_session=")) cookie = pair;
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const GET = (p) => call(p);
const POST = (p, body, key) =>
  call(p, { method: "POST", body, headers: key ? { "Idempotency-Key": key } : {} });

const PIN = "482913";

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await POST("/api/auth/login", { phone: "08012345678", pin: PIN });
  assert.equal(login.status, 200, "seeded user must be able to log in");
  // The success path omits `requiresOtp` entirely; only the OTP branch returns
  // it as `true`. Asserting the cookie proves a session was really issued,
  // where `=== false` proved nothing.
  assert.ok(cookie.startsWith("agbedepay_session="), "login must issue a session cookie");
});

after(async () => {
  // Close the server as well as the pool: an open listener keeps the event loop
  // alive and `node --test` buffers a file's output until the process exits, so
  // a passing suite would otherwise look like it produced nothing.
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await pool.end();
});

// ---- Authentication --------------------------------------------------------

test("every wealth endpoint rejects an anonymous caller", async () => {
  const guarded = [
    ["GET", "/api/wealth/overview"],
    ["GET", "/api/wealth/portfolio"],
    ["GET", "/api/wealth/instruments"],
    ["GET", "/api/wealth/instruments/00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/wealth/history"],
    ["POST", "/api/wealth/orders/buy"],
    ["POST", "/api/wealth/orders/sell"],
  ];
  for (const [method, path] of guarded) {
    const res = await call(path, { method, auth: false });
    assert.equal(res.status, 401, `${method} ${path} must be 401 without a session`);
    assert.equal(res.body.code, "UNAUTHORIZED");
  }
});

// ---- Read endpoints --------------------------------------------------------

test("overview totals are internally consistent", async () => {
  const { status, body } = await GET("/api/wealth/overview");
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const t = body.data.totals;
  // The invariant that matters: value is cost plus gain, to the kobo.
  assert.equal(t.valueMinor, t.costMinor + t.gainMinor, "value must equal cost + gain");
  // `holdingCount` is a sibling of `totals`, not a field inside it — the hub
  // reads `data.holdingCount`, so asserting `totals.holdingCount` was reading
  // `undefined` and comparing it to 0.
  assert.ok(body.data.holdingCount > 0, "seeded user holds something");
  assert.ok(Array.isArray(body.data.allocation));

  // Every allocation share is a real percentage, never a fraction of a percent.
  for (const a of body.data.allocation) {
    assert.ok(a.sharePct >= 0 && a.sharePct <= 100, `share out of range: ${a.sharePct}`);
  }
});

test("portfolio returns only the caller's holdings", async () => {
  const { body } = await GET("/api/wealth/portfolio");
  assert.equal(body.success, true);
  for (const h of body.data.holdings) {
    // Units carry FOUR decimal places and are scaled by 100_000, so the
    // invariant is value = units x price / 100_000, not value = units x price.
    // (1_500_000 units-scaled = 15 units, at 1,066.70 = 1_600_050 kobo.)
    // Getting this wrong makes every assertion in the block read as a 100,000x
    // arithmetic error and looks like a catastrophic backend bug.
    assert.equal(
      h.valueMinor,
      (h.unitsMinor * h.priceMinor) / 100000,
      `${h.symbol}: value must be units x price`
    );
    assert.equal(h.gainMinor, h.valueMinor - h.costMinor, `${h.symbol}: gain must be value - cost`);
  }
});

test("catalogue separates live NGX prices from indicative rates", async () => {
  const { body } = await GET("/api/wealth/instruments");
  const list = body.data.instruments;
  assert.ok(list.length >= 11, "catalogue should hold the seeded universe");

  for (const i of list) {
    if (i.class === "STOCK") {
      assert.equal(i.live, true, `${i.symbol} should carry a live NGX price`);
      assert.equal(i.priceSource, "NGX");
      assert.equal(i.delayedMinutes, 30, "NGX free tier is 30 minutes delayed — say so");
    } else {
      // Honesty contract: no live feed exists for these, so never claim one.
      assert.equal(i.live, false, `${i.symbol} has no live feed and must not claim one`);
      assert.equal(i.priceSource, "INDICATIVE");
      assert.equal(i.delayedMinutes, null);
    }
    assert.ok(i.priceMinor > 0, `${i.symbol} must always have a price`);
  }
});

test("class filter works and unknown classes are rejected", async () => {
  const { body } = await GET("/api/wealth/instruments?class=BOND");
  assert.ok(body.data.instruments.length > 0);
  for (const i of body.data.instruments) assert.equal(i.class, "BOND");

  const bad = await GET("/api/wealth/instruments?class=CRYPTO");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "VALIDATION_ERROR");
});

test("instrument detail resolves one instrument and 404s a stranger", async () => {
  const list = (await GET("/api/wealth/instruments?class=STOCK")).body.data.instruments;
  const one = await GET(`/api/wealth/instruments/${list[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.instrument.id, list[0].id);

  const missing = await GET("/api/wealth/instruments/00000000-0000-4000-8000-000000009999");
  assert.equal(missing.status, 404);
  // The specific code, not the generic NOT_FOUND: the client can tell "no such
  // instrument" apart from "that route does not exist" and show a useful
  // message instead of a generic failure.
  assert.equal(missing.body.code, "INSTRUMENT_NOT_FOUND");
});

test("history paginates, filters by type, and rejects garbage", async () => {
  // The regression this whole block exists for: `?page=1` arrives as the string
  // "1", which an `int` validation rule can never accept. It used to 400 here
  // and took the entire History page down with it.
  const first = await GET("/api/wealth/history?page=1&limit=20");
  assert.equal(first.status, 200, "page/limit must be accepted as query strings");
  assert.ok(first.body.data.total > 0);
  assert.equal(first.body.data.items.length, Math.min(20, first.body.data.total));

  const buys = await GET("/api/wealth/history?type=BUY&page=1&limit=100");
  for (const o of buys.body.data.items) assert.equal(o.type, "BUY");

  const second = await GET("/api/wealth/history?page=2&limit=1");
  assert.equal(second.body.data.page, 2);
  assert.equal(second.body.data.items.length, 1);

  // Still rejects nonsense, just with a readable message.
  assert.equal((await GET("/api/wealth/history?page=abc")).status, 400);
  assert.equal((await GET("/api/wealth/history?type=SCAM")).status, 400);
});

// ---- Order validation (spends all 5 of Ada's rate-limit calls) --------------

test("an order needs an Idempotency-Key", async () => {
  const { instruments } = (await GET("/api/wealth/instruments?class=STOCK")).body.data;
  const res = await POST("/api/wealth/orders/buy", {
    instrumentId: instruments[0].id,
    amountMinor: 200000,
    pin: PIN,
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Idempotency-Key/i);
});

test("buy sizing must be exactly one of amount or units", async () => {
  const { instruments } = (await GET("/api/wealth/instruments?class=STOCK")).body.data;
  const id = instruments[0].id;

  const both = await POST(
    "/api/wealth/orders/buy",
    { instrumentId: id, amountMinor: 200000, unitsMinor: 100000, pin: PIN },
    `both-${Date.now()}`
  );
  assert.equal(both.status, 400);
  assert.match(both.body.message, /not both/i);

  const neither = await POST(
    "/api/wealth/orders/buy",
    { instrumentId: id, pin: PIN },
    `neither-${Date.now()}`
  );
  assert.equal(neither.status, 400);
});

test("buy refuses a dust order and an unaffordable one", async () => {
  const { instruments } = (await GET("/api/wealth/instruments?class=STOCK")).body.data;
  const id = instruments[0].id;

  const dust = await POST(
    "/api/wealth/orders/buy",
    { instrumentId: id, amountMinor: 100, pin: PIN },
    `dust-${Date.now()}`
  );
  assert.equal(dust.status, 400);
  assert.equal(dust.body.code, "ORDER_TOO_SMALL");

  const broke = await POST(
    "/api/wealth/orders/buy",
    { instrumentId: id, amountMinor: 9999999999, pin: PIN },
    `broke-${Date.now()}`
  );
  assert.equal(broke.status, 400);
  assert.equal(broke.body.code, "INSUFFICIENT_FUNDS");
});

// The wrong-PIN case is NOT here. It is in tests/api/wealth-pin.test.js, which
// runs in its own process and therefore has its own rate-limit bucket — see the
// RATE LIMIT BUDGET note at the top of this file.
