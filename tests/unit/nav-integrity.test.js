// tests/unit/nav-integrity.test.js — navigation must not rot.
//
// The bottom nav is hardcoded in ui.js and the Wealth sub-nav is hardcoded in
// wealth-kit.js. Both are arrays of links that nothing validates, so the failure
// mode is always the same and always silent: someone renames a page, or adds a
// feature without adding the tab, and the only symptom is a customer tapping a
// tab that goes nowhere. That is exactly the "nothing is using the Wealth pages"
// bug — all eight pages shipped, and the section was reachable only from one
// tile on the dashboard.
//
// These tests are static (regex over the source) rather than DOM-based because
// the failure we care about is "does this href point at a file that exists",
// which is a question about the filesystem, not about layout.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), "utf8");
const pageExists = (href) => existsSync(fileURLToPath(new URL(`frontend/pages/${href}`, root)));

describe("bottom nav", () => {
  const src = read("frontend/js/ui.js");
  const block = src.match(/const BOTTOM_NAV = \[([\s\S]*?)\];/);
  assert.ok(block, "BOTTOM_NAV not found in ui.js");

  const items = [...block[1].matchAll(/\["(\w+)", "([^"]+)", "([^"]+)", "(\w+)"\]/g)].map((m) => ({
    icon: m[1], label: m[2], href: m[3], key: m[4],
  }));
  assert.ok(items.length > 0, "BOTTOM_NAV parsed empty");

  test("every item points at a page that exists", () => {
    const missing = items.filter((i) => !pageExists(i.href)).map((i) => `${i.key} -> ${i.href}`);
    assert.deepEqual(missing, [], `nav links to missing pages: ${missing.join(", ")}`);
  });

  test("every key is unique, or is-active highlights two tabs", () => {
    const keys = items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate nav key");
  });

  test("Wealth is in the nav, not just behind a dashboard tile", () => {
    // The regression this file exists for. A whole section that is fully built
    // and reachable from exactly one of nine dashboard tiles reads, to a
    // customer, as a feature that is not there.
    assert.ok(
      items.some((i) => i.key === "wealth"),
      "Wealth must be a bottom-nav item"
    );
  });

  test("the CSS column count is not hardcoded past what JS sets", () => {
    // The grid is `repeat(5, 1fr)` in CSS and JS overrides it inline from
    // BOTTOM_NAV.length. If that override is ever removed, the nav silently
    // loses a column and pushes the last tab off-screen — which cannot be seen
    // from a source-level check, so assert the override is still there.
    assert.match(
      src,
      /gridTemplateColumns\s*=\s*`repeat\(\$\{BOTTOM_NAV\.length\}/,
      "renderBottomNav must set the column count from BOTTOM_NAV.length"
    );
  });
});

describe("wealth sub-nav", () => {
  // The kit is an IIFE, so load it in a VM to read SECTIONS.
  const src = read("frontend/js/wealth-kit.js");
  const sandbox = {
    window: {
      AgbeUI: {
        escapeHtml: (s) => String(s ?? ""),
        formatNgn: () => "",
        icon: () => "",
        $: () => null,
        loadingCard: () => "",
      },
    },
    document: { body: { dataset: {} }, querySelector: () => null, addEventListener() {} },
    console, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "wealth-kit.js" });
  const kit = sandbox.window.AgbeWealth;

  test("every section points at a page that exists", () => {
    const missing = kit.SECTIONS.filter((s) => !pageExists(s.href)).map((s) => `${s.key} -> ${s.href}`);
    // `.length === 0` rather than deepEqual: `missing` is built inside the VM
    // realm, so its prototype is not the host's Array and a strict deep
    // equality check fails on two visibly identical empty arrays.
    assert.equal(missing.length, 0, `sub-nav links to missing pages: ${missing.join(", ")}`);
  });

  test("all eight sections are live", () => {
    const dead = kit.SECTIONS.filter((s) => !s.live).map((s) => s.key);
    assert.equal(dead.length, 0, `still marked not-live: ${dead.join(", ")}`);
  });

  test("the hub is reachable from the bottom nav and vice versa", () => {
    const uiSrc = read("frontend/js/ui.js");
    const wealthHref = kit.SECTIONS.find((s) => s.key === "overview").href;
    assert.ok(uiSrc.includes(`"${wealthHref}"`), "bottom nav must link to the Wealth hub");
  });
});
