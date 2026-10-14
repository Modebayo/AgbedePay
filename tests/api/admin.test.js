// tests/api/admin.test.js — Admin console API contract.
//
// Zero dependencies: node:test + node:assert, the same runner `npm test`
// already uses. The app is imported and bound to an ephemeral port in-process.
//
// RUNS AGAINST A DISPOSABLE DATABASE. The suite refuses to start unless
// DATABASE_URL looks like a test database, because it signs in as the seeded
// ADMIN and the seeded CUSTOMER.
//
// Why this file exists: the admin write paths (driver approval, support reply,
// cargo quote) build UPDATE statements that bind one parameter both to a
// VARCHAR column and to a string comparison. That shape is easy to get wrong in
// a way unit tests can't see — Postgres rejects the *whole* statement with
// "inconsistent types deduced for parameter" at plan time. These tests exercise
// the real SQL so that regression is caught here, not in production.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../backend/src/app.js";
import { pool } from "../../backend/src/config/db.js";

// ---- Safety rail -----------------------------------------------------------

const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  throw new Error(
    `Refusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database. ` +
      `Admin tests sign in as seeded accounts and change platform state.`
  );
}

// ---- Tiny HTTP client ------------------------------------------------------

const PIN = "482913";
const ADMIN_PHONE = "08044444444";
const CUSTOMER_PHONE = "08012345678";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const SEEDED_DRIVER_ID = "33333333-3333-4333-8333-333333333333";

let base = "";
let server = null;

async function raw(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

/** Logs in and returns the session cookie, or throws if login failed. */
async function login(phone) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, pin: PIN }),
    redirect: "manual",
  });
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .find((pair) => pair.startsWith("agbedepay_session="));
  assert.ok(cookie, `login as ${phone} must issue a session cookie`);
  return cookie;
}

let admin = "";
let customer = "";

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  admin = await login(ADMIN_PHONE);
  customer = await login(CUSTOMER_PHONE);

  // The support service caps ticket creation per user per 24h (supportService
  // MAX_OPEN_PER_DAY). This suite opens a ticket on every run, so without a
  // reset a handful of consecutive runs would trip the product's own abuse cap
  // and fail for the wrong reason. The database is disposable, so start clean.
  await pool.query("DELETE FROM support_tickets WHERE user_id = $1", [CUSTOMER_ID]);
});

after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await pool.end();
});

// ---- Access control --------------------------------------------------------

test("anonymous callers are rejected before the role check", async () => {
  const { status, body } = await raw("/api/admin/overview");
  assert.equal(status, 401);
  assert.equal(body.code, "UNAUTHORIZED");
});

test("a non-admin is forbidden from every console route", async () => {
  const { status, body } = await raw("/api/admin/overview", { cookie: customer });
  assert.equal(status, 403);
  assert.equal(body.code, "FORBIDDEN");
});

// ---- Overview --------------------------------------------------------------

test("overview reports the platform shape", async () => {
  const { status, body } = await raw("/api/admin/overview", { cookie: admin });
  assert.equal(status, 200);
  assert.ok(body.data.users && typeof body.data.users.total === "number");
  assert.ok(body.data.drivers && typeof body.data.drivers.total === "number");
  assert.ok(Array.isArray(body.data.recent.transactions));
  assert.ok(Array.isArray(body.data.recent.users));
});

// ---- Drivers ---------------------------------------------------------------

test("driver roster lists the seeded driver", async () => {
  const { status, body } = await raw("/api/admin/drivers", { cookie: admin });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.items));
  assert.ok(body.data.items.some((d) => d.userId === SEEDED_DRIVER_ID));
});

test("approving a driver runs the real UPDATE (regression: bound-parameter type)", async () => {
  // ACTIVE keeps is_online unchanged, so this is idempotent for the seeded
  // driver while still compiling and executing the exact statement that once
  // failed with "inconsistent types deduced for parameter $2".
  const { status, body } = await raw(`/api/admin/drivers/${SEEDED_DRIVER_ID}`, {
    method: "PATCH",
    cookie: admin,
    body: { status: "ACTIVE" },
  });
  assert.equal(status, 200);
  assert.equal(body.data.driver.status, "ACTIVE");
});

// ---- Support ---------------------------------------------------------------

test("a ticket can be answered and resolved", async () => {
  const created = await raw("/api/support/tickets", {
    method: "POST",
    cookie: customer,
    body: { category: "RIDE", subject: "Admin API test", message: "Please resolve me." },
  });
  assert.equal(created.status, 201);
  const ticketId = created.body.data.ticket?.id ?? created.body.data.id;
  assert.ok(ticketId, "ticket creation must return an id");

  const replied = await raw(`/api/admin/support/${ticketId}/reply`, {
    method: "POST",
    cookie: admin,
    body: { reply: "All done.", status: "RESOLVED" },
  });
  assert.equal(replied.status, 200);
  assert.equal(replied.body.data.ticket.status, "RESOLVED");
  assert.ok(replied.body.data.ticket.resolvedAt, "resolving must stamp resolved_at");
});

// ---- Cargo -----------------------------------------------------------------

test("a cargo request can be priced and moved to QUOTED", async () => {
  const created = await raw("/api/cargo/requests", {
    method: "POST",
    cookie: customer,
    body: {
      pickupAddress: "12 Marina, Lagos",
      dropoffAddress: "5 Aba Road, Port Harcourt",
      cargoType: "Furniture",
      approxWeightKg: 500,
      contactName: "Ada Obi",
      contactPhone: CUSTOMER_PHONE,
    },
  });
  assert.equal(created.status, 201);
  const quoteId = created.body.data.quote?.id;
  assert.ok(quoteId, "cargo creation must return a quote id");

  const quoted = await raw(`/api/admin/cargo/${quoteId}`, {
    method: "PATCH",
    cookie: admin,
    body: { quotedAmountMinor: 2500000, status: "QUOTED", adminNote: "Covers handling" },
  });
  assert.equal(quoted.status, 200);
  assert.equal(quoted.body.data.quote.status, "QUOTED");
  assert.equal(quoted.body.data.quote.quotedAmountMinor, 2500000);
});
