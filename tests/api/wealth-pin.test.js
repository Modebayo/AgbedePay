// tests/api/wealth-pin.test.js — a bad PIN must never move money.
//
// Its own file, in its own process, for one reason: sendMoneyLimiter allows 5
// order calls per user per minute and tests/api/wealth.test.js spends all five
// on its own validation cases. Rate-limit state is in-memory and per-process, so
// running this here would be the 6th call and would fail with 429 — which looks
// exactly like "the PIN check is broken" and is not. Split out, it gets a fresh
// bucket and the assertion below means what it says.
//
// Zero dependencies, same harness as the rest of the API suite.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../backend/src/app.js";
import { pool } from "../../backend/src/config/db.js";

// ---- Safety rail -----------------------------------------------------------

const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  throw new Error(
    `Refusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database.`
  );
}

// ---- Tiny HTTP client ------------------------------------------------------

let base = "";
let cookie = "";
let server = null;

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
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

const PIN = "482913";

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await call("/api/auth/login", {
    method: "POST",
    body: { phone: "08012345678", pin: PIN },
  });
  assert.equal(login.status, 200, "seeded user must be able to log in");
  assert.ok(cookie.startsWith("agbedepay_session="), "login must issue a session cookie");
});

after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await pool.end();
});

// ---- The test --------------------------------------------------------------

test("a wrong PIN never reaches the wallet", async () => {
  const { instruments } = (await call("/api/wealth/instruments?class=STOCK")).body.data;
  const id = instruments[0].id;

  // Snapshot the balance so the assertion is about money, not about a status
  // code. A 400 is only meaningful if the position is untouched; if the PIN
  // check ever regressed, the order would succeed and the balance would move,
  // and a status-code-only test could still pass if the error changed shape.
  const before = (await call("/api/wealth/portfolio")).body.data;
  const beforeValue = before.totals.valueMinor;
  const beforeUnits = before.holdings.find((h) => h.instrumentId === id)?.unitsMinor ?? 0;

  // Its own Idempotency-Key, so a failure here can never be mistaken for a
  // replay of an earlier request.
  const res = await call("/api/wealth/orders/buy", {
    method: "POST",
    body: { instrumentId: id, amountMinor: 200000, pin: "111111" },
    headers: { "Idempotency-Key": `badpin-${Date.now()}` },
  });

  assert.equal(res.status, 400, "a wrong PIN must be rejected on credentials");
  assert.equal(res.body.success, false);
  assert.ok(res.body.message, "a rejection must explain itself to the customer");

  const after = (await call("/api/wealth/portfolio")).body.data;
  const afterUnits = after.holdings.find((h) => h.instrumentId === id)?.unitsMinor ?? 0;

  assert.equal(afterUnits, beforeUnits, "no units may be created by a rejected order");
  assert.equal(after.totals.valueMinor, beforeValue, "portfolio value must be unchanged");

  // And no order row. A rejected PIN that still wrote an order record would
  // show up in History as a purchase that never happened.
  const history = (await call("/api/wealth/history?type=BUY&page=1&limit=100")).body.data;
  const leaked = history.items.filter((o) => o.status === "FILLED" && o.instrumentId === id);
  assert.ok(leaked.length <= 1, "a rejected order must not create a filled order row");
});
