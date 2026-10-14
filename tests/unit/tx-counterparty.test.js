// tests/unit/tx-counterparty.test.js — the two pure helpers behind the recent
// transaction list's "account name on top of the number" and the airtime
// network logos.
//
// Both are pure (no DOM, no network), so ui.js is loaded into a VM with a
// minimal window/document and the helpers are exercised directly. The failure
// they guard against is subtle and customer-facing: showing the wrong party
// (your own name on a debit), or a raw phone number where a name belongs.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

let ui;

before(() => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/js/ui.js", import.meta.url)), "utf8");
  const sandbox = {
    window: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), body: {}, addEventListener() {} },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "ui.js" });
  ui = sandbox.window.AgbeUI;
});

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";

const transfer = {
  type: "TRANSFER",
  sender: { walletId: W1, name: "Ada Obi", phone: "08012345678" },
  receiver: { walletId: W2, name: "Chidi Nwosu", phone: "08087654321" },
};

describe("txCounterparty", () => {
  test("a credit names the SENDER, on top of their number", () => {
    const p = ui.txCounterparty(transfer, W2);
    assert.equal(p.name, "Ada Obi");
    assert.equal(p.number, "08012345678");
  });

  test("a debit names the RECEIVER, not the paying user", () => {
    const p = ui.txCounterparty(transfer, W1);
    assert.equal(p.name, "Chidi Nwosu");
    assert.equal(p.number, "08087654321");
  });

  test("a top-up has no counterparty — it reads as a self movement", () => {
    const p = ui.txCounterparty({ type: "FUNDING", sender: { walletId: W1, name: "Ada Obi" } }, W1);
    assert.equal(p.name, "Wallet top-up");
    assert.equal(p.number, "");
  });

  test("a cash-out names the bank account holder, with the account number below", () => {
    const p = ui.txCounterparty(
      {
        type: "WITHDRAWAL",
        sender: { walletId: W1, name: "Ada Obi", phone: "08012345678" },
        bank: { bankName: "GTBank", accountName: "John Doe", accountNumber: "0123456789" },
      },
      W1
    );
    assert.equal(p.name, "John Doe");
    assert.equal(p.number, "0123456789");
  });

  test("a bank transfer out with no AgbedePay receiver falls back to the bank account", () => {
    const p = ui.txCounterparty(
      {
        type: "TRANSFER",
        sender: { walletId: W1, name: "Ada Obi", phone: "08012345678" },
        receiver: null,
        bank: { bankName: "Access Bank", accountName: "Jane Roe", accountNumber: "0987654321" },
      },
      W1
    );
    assert.equal(p.name, "Jane Roe");
    assert.equal(p.number, "0987654321");
  });

  test("name is never empty, so the list never renders a blank title", () => {
    const p = ui.txCounterparty({ type: "TRANSFER", sender: { walletId: W1 }, receiver: null }, W1);
    assert.ok(p.name && p.name.length > 0);
  });
});

describe("networkLogo", () => {
  for (const code of ["MTN", "GLO", "AIRTEL", "9MOBILE"]) {
    test(`${code} renders an inline SVG logo`, () => {
      const html = ui.networkLogo(code);
      assert.match(html, /<svg/);
      assert.match(html, /net-logo/);
    });
  }

  test("is case-insensitive", () => {
    assert.match(ui.networkLogo("mtn"), /<svg/);
  });

  test("an unknown network falls back to its name, escaped", () => {
    const html = ui.networkLogo("Acme");
    assert.match(html, /net-logo--fallback/);
    assert.match(html, /Acme/);
    assert.doesNotMatch(html, /<svg/);
  });

  test("the fallback escapes markup it is handed", () => {
    assert.doesNotMatch(ui.networkLogo("<b>x</b>"), /<b>/);
  });
});
