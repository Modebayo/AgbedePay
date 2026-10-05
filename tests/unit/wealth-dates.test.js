// tests/unit/wealth-dates.test.js — date handling at the Wealth edge.
//
// Every one of these is a bug that a developer in one timezone will never see
// and a customer in another will see on their first screen. Postgres returns a
// DATE column as a JS Date pinned to LOCAL midnight; the moment anything calls
// `.toISOString()` on it, the date moves. A bond maturing on the 30th renders
// as "matures on the 29th" for every user east of Greenwich, which is every
// user of a Nigerian product.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toIsoDate, daysToMaturity } from "../../backend/src/services/wealthService.js";

describe("toIsoDate", () => {
  test("formats a plain date string unchanged", () => {
    assert.equal(toIsoDate("2031-06-30"), "2031-06-30");
  });

  test("returns null rather than NaN for nothing", () => {
    assert.equal(toIsoDate(null), null);
    assert.equal(toIsoDate(undefined), null);
    assert.equal(toIsoDate("rubbish"), null);
  });

  test("uses LOCAL calendar fields, never UTC", () => {
    // Exactly how pg hands a DATE back: local midnight. Built the same way here
    // so the test reproduces the driver's behaviour rather than a guess at it.
    const localMidnight = new Date(2031, 5, 30); // 30 June 2031, 00:00 local
    assert.equal(toIsoDate(localMidnight), "2031-06-30");

    // The bug this guards: toISOString() would convert to UTC and, for any
    // timezone east of Greenwich, report 2031-06-29.
    const isoStringWouldSay = localMidnight.toISOString().slice(0, 10);
    if (isoStringWouldSay !== "2031-06-30") {
      assert.notEqual(isoStringWouldSay, "2031-06-30", "precondition: this TZ is ahead of UTC");
    }
    assert.equal(toIsoDate(localMidnight), "2031-06-30", "must not follow toISOString");
  });

  test("pads single-digit months and days", () => {
    assert.equal(toIsoDate(new Date(2027, 0, 5)), "2027-01-05");
  });
});

describe("daysToMaturity", () => {
  const asOf = new Date("2026-09-30T11:00:00.000Z");

  test("counts whole days to a future date", () => {
    assert.equal(daysToMaturity("2026-10-01", asOf), 1);
    assert.equal(daysToMaturity("2026-10-30", asOf), 30);
    assert.equal(daysToMaturity("2027-09-30", asOf), 365);
  });

  test("a bill maturing today is 0 days, not 1", () => {
    // The off-by-one that decides whether a 91-day bill reads "matures today"
    // or "matures tomorrow" — and which is the difference between inviting
    // someone to buy a paper that has already matured.
    assert.equal(daysToMaturity("2026-09-30", asOf), 0);
  });

  test("a date already past is negative, and stays negative", () => {
    // Not clamped to zero. A matured bond should read as matured, not as
    // "maturing today", and the Bonds page styles the two differently.
    // 1 Jan 2020 -> 30 Sep 2026: six years of 365 days plus the 2024 leap day,
    // less the 244 days from 1 Jan to 30 Sep in a common year.
    assert.equal(daysToMaturity("2026-09-29", asOf), -1);
    // 2020-01-01 -> 2026-01-01 is two leap years (2020, 2024) in six years:
    // 6 x 365 + 2. Then 1 Jan -> 30 Sep 2026 is a further 272 days.
    assert.equal(daysToMaturity("2020-01-01", asOf), -(365 * 6 + 2 + 272));
  });

  test("no maturity date is null, not zero", () => {
    // An equity has no maturity. Collapsing that to 0 would print "0 days left"
    // under every share on the Stocks page.
    assert.equal(daysToMaturity(null, asOf), null);
    assert.equal(daysToMaturity(undefined, asOf), null);
  });

  test("the time of day never changes the answer", () => {
    const morning = new Date("2026-09-30T00:01:00.000Z");
    const night = new Date("2026-09-30T23:59:00.000Z");
    assert.equal(daysToMaturity("2026-10-01", morning), 1);
    assert.equal(daysToMaturity("2026-10-01", night), 1);
  });
});
