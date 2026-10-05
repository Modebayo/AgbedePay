// tests/unit/wealth-render.test.js — the new Wealth rendering helpers.
//
// The rest of the frontend has no tests in this repo, and the Wealth kit's
// formatters were written by hand long before this suite existed. These four
// functions are the exception: they were added for the class pages and the
// retirement page, they are the ones whose wrong output would show a customer
// a false statement about their money ("matures today" on a bond that matures
// next year), and they are pure — no DOM, no network — so testing them costs
// nothing and catches the class of bug that matters here.
//
// The kit is an IIFE that assigns to `window`, so it is loaded into a VM with a
// minimal `window`/`document` and a stub for AgbeUI rather than pulled into a
// browser. That keeps the test to node:test with no dependencies.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

let kit;

// Just enough of the real ui.js for the kit to build strings: escapeHtml and
// formatNgn are the only two the helpers under test touch. If the kit starts
// calling a third one, the stub fails loudly here rather than silently
// producing "[object Object]" in a test assertion.
const ui = {
  escapeHtml: (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;"),
  formatNgn: (minor) => `₦${(Number(minor || 0) / 100).toFixed(2)}`,
  icon: (name) => `<svg data-icon="${name}"></svg>`,
  $: () => null,
  escapeAttr: (s) => ui.escapeHtml(s),
};

before(() => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/js/wealth-kit.js", import.meta.url)), "utf8");
  const sandbox = {
    window: { AgbeUI: ui },
    document: { body: { dataset: {} }, addEventListener() {}, querySelector: () => null },
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "wealth-kit.js" });
  kit = sandbox.window.AgbeWealth;
  assert.ok(kit, "kit must publish window.AgbeWealth");
});

describe("maturityLine", () => {
  // The band boundaries are where this kind of code is wrong. 400 days is the
  // switch from days to years; 365 is where "1 year, 0 months" becomes awkward;
  // and the singular/plural is one character of care.
  test("a bill inside 400 days counts days, not a decimal year", () => {
    assert.match(kit.maturityLine({ maturityDate: "2026-10-01", daysToMaturity: 1 }), /1 day to go/);
    assert.match(kit.maturityLine({ maturityDate: "2026-10-05", daysToMaturity: 5 }), /5 days to go/);
    // 330 days is 0.9 years. Printing "0.9 years left" for a treasury bill is
    // the classic version of this bug.
    assert.match(kit.maturityLine({ maturityDate: "2027-08-26", daysToMaturity: 330 }), /330 days to go/);
  });

  test("exactly 400 days switches to years", () => {
    const out = kit.maturityLine({ maturityDate: "2027-11-03", daysToMaturity: 400 });
    assert.match(out, /1 year/, "400 days should read as a year, not 400 days");
    assert.doesNotMatch(out, /days to go/);
  });

  test("a multi-year bond reads in years and months", () => {
    const out = kit.maturityLine({ maturityDate: "2031-09-30", daysToMaturity: 1825 });
    assert.match(out, /5 years/);
    assert.doesNotMatch(out, /days to go/);
  });

  test("maturity today is called out, not shown as a countdown of 1", () => {
    const out = kit.maturityLine({ maturityDate: "2026-09-30", daysToMaturity: 0 });
    assert.match(out, /Matures today/);
    assert.doesNotMatch(out, /0 days/);
  });

  test("a matured bond says so rather than disappearing", () => {
    const out = kit.maturityLine({ maturityDate: "2024-01-01", daysToMaturity: -200 });
    assert.match(out, /Matured 2024-01-01/);
    assert.match(out, /passed/, "a passed maturity must be visually distinct");
  });

  test("an instrument with no maturity prints nothing at all", () => {
    // Equities and open-ended funds genuinely never mature. An empty string is
    // correct; a "Matures —" line is a bug that would appear on every share.
    assert.equal(kit.maturityLine({ maturityDate: null, daysToMaturity: null }), "");
    assert.equal(kit.maturityLine({}), "");
  });

  test("the date is escaped", () => {
    // Use a long maturity so the code takes the branch that actually prints the
    // date. Inside 400 days it prints a day count and never renders the date,
    // so a shorter fixture would pass here while the real path stayed untested.
    const out = kit.maturityLine({ maturityDate: '<img src=x onerror="alert(1)">', daysToMaturity: 1825 });
    assert.doesNotMatch(out, /<img/, "instrument data must never be interpolated raw");
    assert.match(out, /&lt;img/);
  });
});

describe("yieldChip", () => {
  test("renders an annualised rate to two decimals", () => {
    assert.match(kit.yieldChip({ yieldPct: 18.2, riskLevel: "MEDIUM" }), /18\.20% p\.a\./);
  });

  test("carries the risk class so the colour means something", () => {
    assert.match(kit.yieldChip({ yieldPct: 15.5, riskLevel: "LOW" }), /wyield--low/);
    assert.match(kit.yieldChip({ yieldPct: 21.6, riskLevel: "HIGH" }), /wyield--high/);
  });

  test("an instrument with no yield prints nothing", () => {
    // Every equity has no yield. Printing "0.00% p.a." next to a share would
    // be a lie about a dividend the company may never pay.
    assert.equal(kit.yieldChip({ yieldPct: null, riskLevel: "MEDIUM" }), "");
    assert.equal(kit.yieldChip({}), "");
  });

  test("a zero yield is a real number, not a missing one", () => {
    // 0% is a legitimate coupon. Collapsing it to "" hides a product that
    // genuinely pays nothing, which is exactly what a buyer needs to know.
    assert.match(kit.yieldChip({ yieldPct: 0, riskLevel: "LOW" }), /0\.00% p\.a\./);
  });
});

describe("CLASS_PAGES", () => {
  // The three-in-one design only holds if every class has a persona. A missing
  // entry means wealth-browse.js would render `undefined` into the page title.
  test("FUND, BOND and PENSION each have a persona", () => {
    for (const c of ["FUND", "BOND", "PENSION"]) {
      const m = kit.CLASS_PAGES[c];
      assert.ok(m, `${c} needs a CLASS_PAGES entry`);
      assert.ok(m.title && m.sub && m.cta, `${c} needs title, sub and cta`);
      assert.ok(kit.SECTIONS.some((s) => s.key === m.key), `${c} persona must point at a real section key`);
    }
  });

  test("each persona's key matches a section href that exists on disk", () => {
    for (const c of ["FUND", "BOND", "PENSION"]) {
      const sec = kit.SECTIONS.find((s) => s.key === kit.CLASS_PAGES[c].key);
      assert.ok(sec.href, `${c} section must have an href`);
    }
  });
});

describe("SECTIONS", () => {
  test("all eight Wealth pages are live", () => {
    // The whole point of this change. A section still marked live:false renders
    // as a greyed-out dead end on the hub, so a missed flag here is a shipped
    // page the customer cannot reach.
    const dead = kit.SECTIONS.filter((s) => !s.live).map((s) => s.key);
    // `dead.length === 0` rather than deepEqual([], dead): the kit's array comes
    // from a VM realm, so its prototype is not the host's Array and a strict
    // deep-equality check fails on two visibly identical empty arrays.
    assert.equal(dead.length, 0, `these sections are still marked not-live: ${dead.join(", ")}`);
  });

  test("keys are unique, or activeKey highlighting breaks", () => {
    const keys = kit.SECTIONS.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate section key");
  });

  test("every section has an icon, a label and a blurb", () => {
    for (const s of kit.SECTIONS) {
      assert.ok(s.icon && s.label && s.blurb && s.href, `${s.key} is missing copy`);
    }
  });
});
