// tests/unit/transaction-page.test.js — the transaction/receipt/airtime UI
// changes must not rot.
//
// The reverse-transfer action was removed from the transaction page and
// replaced with "Report issue" (a real support ticket). That kind of deletion
// is exactly what silently regresses: a saved modal in a stale branch, a button
// whose handler was left behind. These are static checks over the source —
// there is no DOM in this test runner — so they assert wiring, not pixels.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), "utf8");

const txJs = read("frontend/js/pages/transaction.js");
const txHtml = read("frontend/pages/transaction.html");
const receiptJs = read("frontend/js/pages/receipt.js");
const receiptHtml = read("frontend/pages/receipt.html");
const airtimeJs = read("frontend/js/pages/airtime.js");
const dashboardJs = read("frontend/js/pages/dashboard.js");
const transactionsJs = read("frontend/js/pages/transactions.js");

describe("reverse transfer is gone", () => {
  test("no reverse modal markup remains", () => {
    assert.doesNotMatch(txHtml, /reverse-modal/);
    assert.doesNotMatch(txHtml, /reverse-pin/);
  });

  test("no reverse button or endpoint call remains in the page script", () => {
    assert.doesNotMatch(txJs, /reverse-modal/);
    assert.doesNotMatch(txJs, /reverse-btn/);
    assert.doesNotMatch(txJs, /\/reverse/);
  });
});

describe("report issue files a real support ticket", () => {
  test("the page posts to the support tickets endpoint", () => {
    assert.match(txJs, /\/support\/tickets/);
  });

  test("the category it sends is valid per the server schema", () => {
    const schema = read("backend/src/validators/supportSchemas.js");
    const allowed = [...schema.matchAll(/"(PAYMENT|WITHDRAWAL|KYC|DISPATCH|RIDE|CARD|OTHER)"/g)].map((m) => m[1]);
    const used = [...txJs.matchAll(/"(PAYMENT|WITHDRAWAL|KYC|DISPATCH|RIDE|CARD|OTHER)"/g)].map((m) => m[1]);
    assert.ok(used.length > 0, "transaction.js must send a category");
    for (const c of used) assert.ok(allowed.includes(c), `unknown category ${c}`);
  });

  test("the modal exists with the message field the script expects", () => {
    assert.match(txHtml, /id="issue-modal"/);
    assert.match(txHtml, /id="issue-message"/);
    assert.match(txJs, /#issue-message/);
  });
});

describe("receipt is a share action, not a save/print label", () => {
  test("the toolbar button is labelled Share PDF", () => {
    assert.match(receiptHtml, /id="share-btn"/);
    assert.match(receiptHtml, /Share PDF/);
    assert.doesNotMatch(receiptHtml, /Print \/ Save/);
  });

  test("sharing uses the Web Share API with a print fallback", () => {
    assert.match(receiptJs, /navigator\.share/);
    assert.match(receiptJs, /window\.print\(\)/);
    assert.match(receiptJs, /#share-btn/);
  });

  test("the transaction page links to the receipt as Share PDF", () => {
    assert.match(txJs, /receipt\.html\?id=/);
    assert.match(txJs, /Share PDF/);
  });
});

describe("recent lists show the counterparty name", () => {
  test("dashboard and transactions use txCounterparty", () => {
    assert.match(dashboardJs, /ui\.txCounterparty\(/);
    assert.match(transactionsJs, /ui\.txCounterparty\(/);
  });
});

describe("airtime shows network logos", () => {
  test("the network picker renders logos instead of names", () => {
    assert.match(airtimeJs, /ui\.networkLogo\(/);
  });
});
