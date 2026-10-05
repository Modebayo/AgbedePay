// tests/unit/retirement-projection.test.js — the retirement maths, tested.
//
// These are PURE functions: no database, no network, no clock. Every one takes
// the "as of" date as an argument precisely so a test can pin it, which is why
// this file runs anywhere and finishes in milliseconds.
//
// The assertions here are the honesty contract for the whole feature. If one of
// these changes, the Retirement page starts telling people something the maths
// does not support, and that is the one bug in this app that cannot be rolled
// back — you cannot un-promise someone's retirement.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  monthsBetween,
  futureValueMinor,
  requiredMonthlyMinor,
  ageFromDateOfBirth,
  projectGoal,
  DEFAULT_RETURN_PCT,
} from "../../backend/src/services/retirementService.js";

// 2026-01-15, mid-month on purpose: month arithmetic that only works on the
// 1st of a month is not month arithmetic.
const AS_OF = new Date("2026-01-15T09:30:00.000Z");

describe("monthsBetween", () => {
  test("counts whole calendar months", () => {
    assert.equal(monthsBetween(AS_OF, new Date("2026-02-15T00:00:00Z")), 1);
    assert.equal(monthsBetween(AS_OF, new Date("2027-01-15T00:00:00Z")), 12);
    assert.equal(monthsBetween(AS_OF, new Date("2036-01-15T00:00:00Z")), 120);
  });

  test("does not count a month whose day has not arrived", () => {
    // The 14th of February is still "some time in January plus 30 days".
    assert.equal(monthsBetween(AS_OF, new Date("2026-02-14T00:00:00Z")), 0);
    assert.equal(monthsBetween(AS_OF, new Date("2026-02-16T00:00:00Z")), 1);
  });

  test("crossing a year boundary the long way round", () => {
    assert.equal(monthsBetween(AS_OF, new Date("2027-02-14T00:00:00Z")), 12);
    assert.equal(monthsBetween(AS_OF, new Date("2027-02-15T00:00:00Z")), 13);
  });

  test("a date in the past is zero months, never negative", () => {
    // This is a safety property, not cosmetics: the caller does `months > 0`
    // checks, and a negative horizon reaching the maths below would flip signs
    // and produce a confident, completely wrong projection.
    assert.equal(monthsBetween(AS_OF, new Date("2020-01-15T00:00:00Z")), 0);
    assert.equal(monthsBetween(AS_OF, AS_OF), 0);
  });

  test("a 28-day February is one month, not 30/28 of one", () => {
    // Dividing by an average month length is the classic way to get this wrong.
    assert.equal(monthsBetween(new Date("2027-01-28T00:00:00Z"), new Date("2027-02-28T00:00:00Z")), 1);
  });
});

describe("futureValueMinor", () => {
  test("a zero horizon is just the pot", () => {
    assert.equal(futureValueMinor({ potMinor: 1000000, monthlyMinor: 50000, months: 0 }), 1000000);
  });

  test("a zero return is pot plus contributions, to the kobo", () => {
    // The r=0 branch. Without it this is 0/0 -> NaN, and the customer who
    // sensibly assumes no growth gets a blank page.
    assert.equal(
      futureValueMinor({ potMinor: 1000000, monthlyMinor: 50000, annualPct: 0, months: 12 }),
      1000000 + 50000 * 12
    );
  });

  test("compounds monthly, and the answer is never below the contributions", () => {
    const v = futureValueMinor({ potMinor: 1000000, monthlyMinor: 100000, annualPct: 12, months: 12 });
    const floor = 1000000 + 100000 * 12;
    assert.ok(v > floor, "growth must be added to, not replace, the contributions");
    // 12% a year compounded monthly on ₦10,000 + ₦1,000/mo lands near ₦23,100.
    assert.ok(v > 2250000 && v < 2400000, `unexpected value ${v}`);
  });

  test("more time never yields less", () => {
    let previous = -Infinity;
    for (let months = 0; months <= 360; months += 12) {
      const v = futureValueMinor({ potMinor: 5000000, monthlyMinor: 200000, annualPct: 12, months });
      assert.ok(v >= previous, `month ${months} went backwards`);
      previous = v;
    }
  });

  test("a negative return loses money but never goes below zero contributions", () => {
    // Not reachable from the API (returnPct is clamped to >= 0) but the maths
    // should degrade sensibly rather than produce a negative pot.
    const v = futureValueMinor({ potMinor: 1000000, monthlyMinor: 0, annualPct: -50, months: 12 });
    assert.ok(v > 0 && v < 1000000, `unexpected value ${v}`);
  });
});

describe("requiredMonthlyMinor", () => {
  test("no time left means no answer, not a huge number", () => {
    assert.equal(requiredMonthlyMinor({ potMinor: 0, targetMinor: 5000000, months: 0 }), null);
  });

  test("an existing pot that already outgrows the target needs nothing more", () => {
    // The honest answer is 0, not a negative "you can withdraw" figure.
    assert.equal(
      requiredMonthlyMinor({ potMinor: 50000000, targetMinor: 1000000, annualPct: 0, months: 12 }),
      0
    );
  });

  test("hits the target to within a kobo", () => {
    const potMinor = 1000000; // ₦10,000
    const targetMinor = 100000000; // ₦1,000,000
    const annualPct = 12;
    const months = 240; // 20 years

    const required = requiredMonthlyMinor({ potMinor, targetMinor, annualPct, months });
    const landed = futureValueMinor({ potMinor, monthlyMinor: required, annualPct, months });
    // Rounding the requirement UP to a whole kobo is what keeps this honest:
    // rounding down would promise a target it cannot reach.
    assert.ok(landed >= targetMinor, `landed ${landed} short of ${targetMinor}`);
    assert.ok(landed - targetMinor < 100000, `overshoot should be under ₦1,000, was ${landed - targetMinor}`);
  });

  test("a higher return never demands more money", () => {
    const base = { potMinor: 1000000, targetMinor: 100000000, months: 240 };
    const low = requiredMonthlyMinor({ ...base, annualPct: 0 });
    const high = requiredMonthlyMinor({ ...base, annualPct: 12 });
    assert.ok(high < low, `12% (${high}) should need less than 0% (${low})`);
  });
});

describe("ageFromDateOfBirth", () => {
  test("is exact on the birthday, and a day short the day before", () => {
    assert.equal(ageFromDateOfBirth("1990-06-20", new Date("2026-06-20T00:00:00Z")), 36);
    assert.equal(ageFromDateOfBirth("1990-06-20", new Date("2026-06-19T23:59:59Z")), 35);
  });

  test("returns null rather than guessing when there is no DOB", () => {
    // The caller must be able to tell "we do not know" from "they are 0".
    assert.equal(ageFromDateOfBirth(null), null);
    assert.equal(ageFromDateOfBirth(undefined), null);
    assert.equal(ageFromDateOfBirth("not-a-date"), null);
  });
});

describe("projectGoal", () => {
  // A goal row, exactly as wealth_goals stores it. Kobo throughout.
  const goal = {
    name: "Retire at 60",
    current_age: 31,
    target_age: 60,
    target_amount_minor: 5000000000, // ₦50,000,000.00
    current_amount_minor: 12000000, // ₦120,000.00
    monthly_contribution_minor: 25000000, // ₦250,000.00
    target_date: "2051-01-15", // 25 years and 0 months from AS_OF
    status: "ACTIVE",
  };

  const project = (over = {}) =>
    projectGoal({
      goal,
      potMinor: 12000000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
      asOf: AS_OF,
      ...over,
    });

  test("the horizon comes from the target date, not from the ages", () => {
    assert.equal(project().monthsRemaining, 25 * 12);
    assert.equal(project().yearsRemaining, 25);
    assert.equal(project().ageAtTarget, 56);
  });

  test("ALWAYS reports the return-free projection next to the assumed one", () => {
    // The single most important assertion in this file. A retirement tool that
    // shows one optimistic number is a sales tool. The zero-return figure is
    // what the customer is actually guaranteed by their own savings rate.
    const p = project();
    assert.ok(p.projectedAtZeroReturnMinor > 0, "there must always be a return-free number");
    assert.ok(
      p.projectedAtZeroReturnMinor < p.projectedMinor,
      "the assumed return must show up as the difference between the two"
    );
    assert.equal(p.assumedGrowthMinor, p.projectedMinor - p.projectedAtZeroReturnMinor);
  });

  test("the verdict is measured against the honest number, not the optimistic one", () => {
    // Potted at ₦120,000 + ₦250,000/mo for 25 years, this customer reaches
    // ₦75.3m with NO growth at all. Against a ₦50m target that clears the bar on
    // savings alone, so the honest verdict is AHEAD and it does not depend on
    // the market doing anything.
    const p = project();
    assert.equal(p.projectedAtZeroReturnMinor, 12000000 + 25000000 * 300);
    assert.equal(p.status, "AHEAD");
    assert.equal(p.statusAtZeroReturn, "AHEAD");
    assert.equal(p.statusNeedsGrowth, false, "savings alone clear it, so no caveat is needed");
    assert.equal(p.gapMinor, p.projectedAtZeroReturnMinor - p.targetMinor);
    assert.ok(p.gapMinor > 0, "contributions alone clear the target");
    // No promise language. Ever.
    assert.doesNotMatch(p.verdict, /guarantee|will have|ensure/i);
  });

  test("on track ONLY because of the assumed return, and it says so", () => {
    // The case this whole design exists for. Pot ₦500,000 + ₦300,000/mo for 25
    // years is ₦90.5m with no growth — so set the target to ₦120m: contributions
    // alone fall short, and only the assumed 12% closes the gap.
    const p = projectGoal({
      goal: { ...goal, target_amount_minor: 12000000000, monthly_contribution_minor: 30000000 },
      potMinor: 50000000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
      asOf: AS_OF,
    });
    assert.equal(p.projectedAtZeroReturnMinor, 50000000 + 30000000 * 300);
    assert.ok(p.projectedAtZeroReturnMinor < p.targetMinor, "precondition: short without growth");
    assert.ok(p.projectedMinor >= p.targetMinor, "precondition: clears it with growth");

    assert.notEqual(p.status, "BEHIND", "the headline verdict may use the stated assumption");
    assert.equal(p.statusAtZeroReturn, "BEHIND", "but savings alone are behind");
    assert.equal(p.statusNeedsGrowth, true, "and the difference is advertised, not hidden");
    assert.match(p.verdict, /depends on the market/i);
    // The gap quoted in the verdict is the shortfall, so it must read positive
    // to a human even though gapMinor itself is negative.
    assert.match(p.verdict, /short/);
    assert.doesNotMatch(p.verdict, /guarantee|will have|ensure/i);
  });

  test("required contribution is reported under both assumptions", () => {
    const p = project();
    assert.ok(p.requiredMonthlyMinor > 0);
    // At 0% the required amount can only be HIGHER — a lower requirement under
    // a lower return would mean the maths is inconsistent.
    assert.ok(
      p.requiredMonthlyAtZeroReturnMinor >= p.requiredMonthlyMinor,
      `zero-return requirement (${p.requiredMonthlyAtZeroReturnMinor}) cannot be below the assumed one (${p.requiredMonthlyMinor})`
    );
  });

  test("a pot that clears the target today is ACHIEVED", () => {
    const p = project({ potMinor: 6000000000 });
    assert.equal(p.status, "ACHIEVED");
    assert.equal(p.statusAtZeroReturn, "ACHIEVED");
    assert.equal(p.statusNeedsGrowth, false);
    assert.match(p.verdict, /already/i);
  });

  test("contributing nothing with a target out of reach is BEHIND", () => {
    const p = projectGoal({
      goal: { ...goal, monthly_contribution_minor: 0 },
      potMinor: 100000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
      asOf: AS_OF,
    });
    assert.equal(p.status, "BEHIND");
    assert.equal(p.statusAtZeroReturn, "BEHIND");
    assert.ok(p.requiredMonthlyMinor > 0, "BEHIND must come with an actionable number");
  });

  test("the ON_TRACK / AHEAD boundary is exactly the required amount", () => {
    // Pinned from both sides. Note the UNROUNDED requirement: the service
    // compares against the exact figure, and a rounded-up contribution is
    // genuinely (fractionally) more than required — which is AHEAD, correctly.
    const required = requiredMonthlyMinor({
      potMinor: 100000,
      targetMinor: 5000000000,
      annualPct: DEFAULT_RETURN_PCT,
      months: 300,
    });
    const at = (monthlyContributionMinor) =>
      projectGoal({
        goal: { ...goal, monthly_contribution_minor: monthlyContributionMinor },
        potMinor: 100000,
        potSource: "MANUAL",
        expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
        asOf: AS_OF,
      }).status;

    assert.equal(at(required), "ON_TRACK", "exactly enough is on track");
    assert.equal(at(required + 1), "AHEAD", "a kobo more is ahead");
    assert.equal(at(required - 1), "BEHIND", "a kobo less is behind");
  });

  test("contributing more than required reads AHEAD", () => {
    const p = projectGoal({
      goal: { ...goal, monthly_contribution_minor: 90000000 }, // ₦900,000/mo
      potMinor: 100000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: 0, // no assumed return: AHEAD is then unambiguous
      asOf: AS_OF,
    });
    assert.equal(p.status, "AHEAD");
  });

  test("a target date in the past is BEHIND, with no infinite maths", () => {
    const p = projectGoal({
      goal: { ...goal, target_date: "2020-01-15" },
      potMinor: 100000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
      asOf: AS_OF,
    });
    assert.equal(p.monthsRemaining, 0);
    assert.equal(p.requiredMonthlyMinor, null);
    assert.equal(p.status, "BEHIND");
  });

  test("the series is capped and always lands on the target date", () => {
    const p = project();
    assert.ok(p.series.length <= 26, `series too long: ${p.series.length}`);
    assert.equal(p.series.at(-1).months, 300);
    for (const point of p.series) {
      assert.ok(point.valueMinor >= point.contributedMinor, "growth cannot reduce the pot");
      assert.ok(point.age >= 31, "the age must move forwards");
      assert.match(point.valueNgn, /^₦/, "every point is pre-formatted for the chart");
    }
  });

  test("a 70-year horizon is still a readable chart", () => {
    const p = projectGoal({
      goal: { ...goal, current_age: 25, target_age: 95, target_date: "2096-01-15" },
      potMinor: 100000,
      potSource: "MANUAL",
      expectedAnnualReturnPct: DEFAULT_RETURN_PCT,
      asOf: AS_OF,
    });
    assert.ok(p.series.length <= 26, `series too long: ${p.series.length}`);
    assert.equal(p.series.at(-1).months, 70 * 12);
  });

  test("a zero return produces no NaN anywhere in the payload", () => {
    // r = 0 is the branch most likely to leak a division by zero, and NaN
    // serialises to null in JSON, which would render as a blank cell with no
    // error anywhere to find it.
    const p = project({ expectedAnnualReturnPct: 0 });
    for (const [key, value] of Object.entries(p)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value), `${key} is ${value}`);
      }
    }
    assert.equal(p.assumedGrowthMinor, 0);
  });
});
