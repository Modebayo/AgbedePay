// tests/api/retirement.test.js — the Retirement Goal API contract.
//
// A SEPARATE file from wealth.test.js on purpose. That file's header documents a
// 5-call-per-minute order budget it deliberately spends 4 of, and adding to it
// would break a documented, deliberate limit. Goals move no money and take no
// rate limit, so they get their own process and their own clean buckets.
//
// SELF-CONTAINED. Unlike wealth.test.js — which reads seeded holdings and spends
// seeded balance — this file creates, edits and closes its OWN goal, and clears
// whatever goal the account already had before it starts. It therefore needs
// only a migrated, seeded database for the portfolio and the login, and it can
// be re-run any number of times in any order. Still a disposable database:
// DATABASE_URL is checked before a single query runs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../backend/src/app.js";
import { pool } from "../../backend/src/config/db.js";

// ---- Safety rail -----------------------------------------------------------

const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  throw new Error(
    `Refusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database. ` +
      `These tests create, edit and close a retirement goal.`
  );
}

// ---- Tiny HTTP client ------------------------------------------------------

let base = "";
let cookie = "";

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

const GET = (p) => call(p);
const POST = (p, body) => call(p, { method: "POST", body });
const PATCH = (p, body) => call(p, { method: "PATCH", body });
const DELETE = (p) => call(p, { method: "DELETE" });

const PIN = "482913";

// A date N years out, on the same day of the month as today so the horizon is
// a clean multiple of twelve months.
function futureIsoDate(yearsAhead) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + yearsAhead);
  return d.toISOString().slice(0, 10);
}

// ₦50,000,000.00 target, ₦250,000.00 a month, 25 years out, at age 31 → 56.
const VALID_GOAL = {
  name: "Retire comfortably",
  currentAge: 31,
  targetAge: 60,
  targetAmountMinor: 5000000000,
  currentAmountMinor: 5000000,
  monthlyContributionMinor: 25000000,
  targetDate: futureIsoDate(25),
};

let server = null;
let goalId = null;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await POST("/api/auth/login", { phone: "08012345678", pin: PIN });
  assert.equal(login.status, 200, "seeded user must be able to log in");
  // The success path simply omits `requiresOtp` — its presence with `true` is
  // what means "security code required, no session issued". Asserting the
  // session cookie is the real check that login actually worked.
  assert.ok(cookie.startsWith("agbedepay_session="), "login must issue a session cookie");

  // Clear whatever goal is already there (the seed creates one) so this file
  // owns the account's goal for its whole run.
  const existing = await GET("/api/wealth/retirement");
  if (existing.body.data.goal && existing.body.data.goal.status === "ACTIVE") {
    const closed = await DELETE(`/api/wealth/retirement/${existing.body.data.goal.id}`);
    assert.equal(closed.status, 200, "must be able to clear a pre-existing goal");
  }

  const created = await POST("/api/wealth/retirement", VALID_GOAL);
  assert.equal(created.status, 201, `could not set up: ${created.body?.message ?? ""}`);
  goalId = created.body.data.goal.id;
});

after(async () => {
  // Close the server as well as the pool. An open listener keeps the event loop
  // alive, and `node --test` buffers a file's output until the process exits —
  // so forgetting this makes a fully passing suite look like it produced nothing.
  if (goalId) await DELETE(`/api/wealth/retirement/${goalId}`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ---- Authentication --------------------------------------------------------

test("every retirement endpoint rejects an anonymous caller", async () => {
  const guarded = [
    ["GET", "/api/wealth/retirement"],
    ["POST", "/api/wealth/retirement"],
    ["PATCH", "/api/wealth/retirement/00000000-0000-4000-8000-000000000001"],
    ["DELETE", "/api/wealth/retirement/00000000-0000-4000-8000-000000000001"],
  ];
  for (const [method, path] of guarded) {
    const res = await call(path, { method, auth: false });
    assert.equal(res.status, 401, `${method} ${path} must be 401 without a session`);
    assert.equal(res.body.code, "UNAUTHORIZED");
  }
});

// ---- The summary the page opens on -----------------------------------------

describe("GET /retirement", () => {
  test("returns the goal with a projection", async () => {
    const { status, body } = await GET("/api/wealth/retirement");
    assert.equal(status, 200);
    assert.equal(body.success, true);

    assert.ok(body.data.goal, "a goal must come back");
    assert.equal(body.data.goal.id, goalId);
    assert.equal(body.data.goal.status, "ACTIVE");
    assert.ok(body.data.projection, "a goal must come with a projection");
    assert.equal(body.data.projection.expectedAnnualReturnPct, 12, "the documented default");
    assert.ok(["AHEAD", "ON_TRACK", "BEHIND", "ACHIEVED"].includes(body.data.projection.status));
  });

  test("the projection always carries the return-free figure beside the assumed one", async () => {
    // The honesty contract, asserted over HTTP this time. If a future edit drops
    // the zero-return column, the page silently becomes a sales tool and no
    // other assertion in this suite would notice.
    const p = (await GET("/api/wealth/retirement")).body.data.projection;

    assert.ok(p.projectedAtZeroReturnMinor > 0, "there must always be a return-free number");
    assert.equal(
      p.assumedGrowthMinor,
      p.projectedMinor - p.projectedAtZeroReturnMinor,
      "the assumed return must be exactly the difference between the two"
    );
    assert.equal(
      p.gapMinor,
      p.projectedAtZeroReturnMinor - p.targetMinor,
      "the gap is measured on savings alone, never on the optimistic figure"
    );
    assert.equal(typeof p.statusAtZeroReturn, "string");
    assert.equal(typeof p.statusNeedsGrowth, "boolean");
    assert.ok(p.series.length > 0, "the chart needs at least one point");
    assert.ok(p.series.length <= 26, "and never a chart nobody can read");
  });

  test("the pot is real money, and says where it came from", async () => {
    const p = (await GET("/api/wealth/retirement")).body.data.projection;
    assert.ok(["PORTFOLIO", "MANUAL", "NONE"].includes(p.potSource));
    assert.ok(p.potMinor > 0, "the seeded user holds investments, so the pot is real");
    assert.equal(p.potSource, "PORTFOLIO", "a live portfolio beats a typed-in number");
  });

  test("the return assumption is adjustable, and nonsense falls back safely", async () => {
    const zero = await GET("/api/wealth/retirement?returnPct=0");
    assert.equal(zero.body.data.projection.expectedAnnualReturnPct, 0);
    // At 0% the two figures must be identical — there is no assumed growth.
    assert.equal(zero.body.data.projection.assumedGrowthMinor, 0);

    const high = await GET("/api/wealth/retirement?returnPct=30");
    assert.equal(high.body.data.projection.expectedAnnualReturnPct, 30);

    // Query params are strings, and this is a DISPLAY assumption: a bad value
    // must not 400 and take the whole page down with it.
    for (const bad of ["abc", "-5", "999", ""]) {
      const res = await GET(`/api/wealth/retirement?returnPct=${bad}`);
      assert.equal(res.status, 200, `returnPct=${bad} must not break the page`);
      assert.equal(res.body.data.projection.expectedAnnualReturnPct, 12, `returnPct=${bad} falls back`);
    }
  });
});

// ---- Creating --------------------------------------------------------------

describe("POST /retirement", () => {
  test("refuses a second active goal rather than quietly replacing the first", async () => {
    // One live goal per person: a retirement target is a single question, and
    // three live answers to it make the number on the page arbitrary.
    const res = await POST("/api/wealth/retirement", VALID_GOAL);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "GOAL_EXISTS");
  });

  test("rejects rules only the service can check", async () => {
    // These three compare two fields, or compare the request against the
    // calendar — a schema cannot express either, so they are the service's job.
    const cases = [
      [{ ...VALID_GOAL, targetAge: 30 }, /later than your current age/i],
      [{ ...VALID_GOAL, targetDate: "2020-01-01" }, /in the past/i],
      [{ ...VALID_GOAL, targetDate: futureIsoDate(80) }, /less than 50 years/i],
    ];
    for (const [body, pattern] of cases) {
      const res = await POST("/api/wealth/retirement", body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)} should be rejected`);
      assert.equal(res.body.code, "VALIDATION_ERROR");
      assert.match(res.body.message, pattern);
    }
  });

  test("rejects a malformed body at the schema", async () => {
    const cases = [
      { ...VALID_GOAL, name: undefined },
      // `required` trims, so whitespace-only is a schema rejection.
      { ...VALID_GOAL, name: "   " },
      { ...VALID_GOAL, targetAge: "sixty" },
      { ...VALID_GOAL, targetAmountMinor: 5000.5 }, // floats are not kobo
      { ...VALID_GOAL, targetDate: "15/01/2051" },
      { ...VALID_GOAL, monthlyContributionMinor: -1 },
      // The service carries the same floor as defence in depth for non-HTTP
      // callers, but over HTTP the schema always speaks first.
      { ...VALID_GOAL, targetAmountMinor: 100 },
    ];
    for (const body of cases) {
      const res = await POST("/api/wealth/retirement", body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)} should be rejected`);
      assert.equal(res.body.code, "VALIDATION_ERROR");
    }
  });

  test("a date of birth on the account wins over the age the client claims", async () => {
    // The seeded user has no DOB, so there is nothing to override here — but the
    // claim is stored and reported honestly as such, rather than as a fact.
    const { body } = await GET("/api/wealth/retirement");
    assert.ok(["DATE_OF_BIRTH", "GOAL", "UNKNOWN", "CLAIMED"].includes(body.data.ageSource));
    assert.equal(body.data.hasDateOfBirth, false, "the seeded user has not completed KYC");
    assert.equal(body.data.currentAge, 31, "so the age falls back to the goal's own");
  });
});

// ---- Reading, editing and closing ------------------------------------------

describe("PATCH and DELETE /retirement/:id", () => {
  test("a goal id belonging to someone else is a 404, not a 403", async () => {
    // 403 would confirm the id exists; 404 leaks nothing. Same rule as a sell.
    const stranger = "00000000-0000-4000-8000-000000009999";
    assert.equal((await PATCH(`/api/wealth/retirement/${stranger}`, { name: "Mine now" })).status, 404);
    assert.equal((await DELETE(`/api/wealth/retirement/${stranger}`)).status, 404);
  });

  test("a non-uuid id is rejected before any lookup", async () => {
    assert.equal((await PATCH("/api/wealth/retirement/not-a-uuid", { name: "x" })).status, 400);
  });

  test("a PATCH with nothing to change must not answer 200", async () => {
    // Otherwise a client bug — a typo'd field name — looks like a successful save.
    const res = await PATCH(`/api/wealth/retirement/${goalId}`, {});
    assert.equal(res.status, 400);
    assert.match(res.body.message, /nothing to update/i);
  });

  test("a PATCH is re-checked against the STORED current age", async () => {
    // Not against the request's own numbers: two fields in one body that
    // disagree with each other must not be able to smuggle an incoherent row in.
    const backwards = await PATCH(`/api/wealth/retirement/${goalId}`, { targetAge: 20 });
    assert.equal(backwards.status, 400);
    assert.match(backwards.body.message, /later than your current age/i);
  });

  test("a PATCH re-projects rather than just storing the new numbers", async () => {
    const good = await PATCH(`/api/wealth/retirement/${goalId}`, {
      monthlyContributionMinor: 75000000, // ₦750,000.00
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.data.goal.monthlyContributionMinor, 75000000);

    // The next read reflects it in the projection, not only on the goal.
    const after = (await GET("/api/wealth/retirement")).body.data;
    assert.equal(after.projection.monthlyMinor, 75000000);
    assert.equal(after.goal.monthlyContributionMinor, 75000000);

    // Put it back so the later assertions read a known figure.
    await PATCH(`/api/wealth/retirement/${goalId}`, { monthlyContributionMinor: 25000000 });
  });

  test("closing keeps the row, and a closed goal can no longer be edited", async () => {
    const closed = await DELETE(`/api/wealth/retirement/${goalId}`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.goal.status, "CLOSED");

    const edit = await PATCH(`/api/wealth/retirement/${goalId}`, {
      monthlyContributionMinor: 100000,
    });
    assert.equal(edit.status, 400);
    assert.equal(edit.body.code, "GOAL_CLOSED");

    // Still readable: a closed goal is history, not a gap in the page.
    const { body } = await GET("/api/wealth/retirement");
    assert.equal(body.data.goal.id, goalId);
    assert.equal(body.data.goal.status, "CLOSED");
  });
});
