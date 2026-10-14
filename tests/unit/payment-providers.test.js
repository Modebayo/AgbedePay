// tests/unit/payment-providers.test.js — the security-critical pure logic of
// the payment providers, tested without any network or database.
//
// Webhook signature verification is the single most important check in the
// whole payments flow: if it is wrong, anyone can POST a fake "paid" event and
// mint wallet balance. So it is tested directly, including the negative cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PaystackProvider } from "../../backend/src/providers/paystackProvider.js";
import { FlutterwaveProvider } from "../../backend/src/providers/flutterwaveProvider.js";
import { mockPaymentProvider } from "../../backend/src/providers/mockPaymentProvider.js";

// ---- Paystack --------------------------------------------------------------

const SECRET = "sk_test_super_secret";

function paystack() {
  return new PaystackProvider({ secretKey: SECRET, publicKey: "pk_test_x", baseUrl: "https://api.paystack.co" });
}

test("Paystack webhook signature: accepts a correct HMAC-SHA512, rejects a forgery", () => {
  const p = paystack();
  const rawBody = Buffer.from(
    JSON.stringify({ event: "charge.success", data: { id: 42, reference: "PAY-1", status: "success", amount: 50000 } })
  );
  const good = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");

  assert.equal(p.verifyWebhook({ rawBody, headers: { "x-paystack-signature": good } }), true);
  assert.equal(p.verifyWebhook({ rawBody, headers: { "x-paystack-signature": "deadbeef" } }), false);
  // Same body, signed with the WRONG key — the attack we care about.
  const forged = crypto.createHmac("sha512", "sk_test_attacker").update(rawBody).digest("hex");
  assert.equal(p.verifyWebhook({ rawBody, headers: { "x-paystack-signature": forged } }), false);
});

test("Paystack webhook signature: missing header is rejected (never treated as valid)", () => {
  const p = paystack();
  const rawBody = Buffer.from("{}");
  assert.equal(p.verifyWebhook({ rawBody, headers: {} }), false);
});

test("Paystack parseWebhook maps status, amount and a stable event id", () => {
  const p = paystack();
  const parsed = p.parseWebhook({
    event: "charge.success",
    data: { id: 42, reference: "PAY-1", status: "success", amount: 50000 },
  });
  assert.equal(parsed.status, "SUCCESS");
  assert.equal(parsed.reference, "PAY-1");
  assert.equal(parsed.amountMinor, 50000);
  assert.equal(parsed.providerRef, "42");
  assert.equal(parsed.eventId, "charge.success:42");
});

test("Paystack parseWebhook treats non-success as PENDING/FAILED, not SUCCESS", () => {
  const p = paystack();
  assert.equal(p.parseWebhook({ event: "charge.failed", data: { id: 1, status: "failed" } }).status, "FAILED");
  assert.equal(p.parseWebhook({ event: "charge.pending", data: { id: 2, status: "pending" } }).status, "PENDING");
});

// ---- Flutterwave -----------------------------------------------------------

test("Flutterwave webhook: verif-hash is compared exactly and a missing hash never passes", () => {
  const p = new FlutterwaveProvider({
    secretKey: "FLWSECK",
    publicKey: "FLWPUBK",
    webhookHash: "hash123",
    baseUrl: "https://api.flutterwave.com/v3",
  });
  assert.equal(p.verifyWebhook({ headers: { "verif-hash": "hash123" } }), true);
  assert.equal(p.verifyWebhook({ headers: { "verif-hash": "wrong" } }), false);
  assert.equal(p.verifyWebhook({ headers: {} }), false);
});

test("Flutterwave parseWebhook converts MAJOR units (naira) to integer kobo", () => {
  const p = new FlutterwaveProvider({
    secretKey: "FLWSECK",
    publicKey: "FLWPUBK",
    webhookHash: "hash123",
    baseUrl: "https://api.flutterwave.com/v3",
  });
  const parsed = p.parseWebhook({
    event: "charge.completed",
    data: { id: 9, tx_ref: "PAY-2", status: "successful", amount: 250.5 },
  });
  assert.equal(parsed.status, "SUCCESS");
  assert.equal(parsed.reference, "PAY-2");
  assert.equal(parsed.amountMinor, 25050);
  assert.equal(parsed.eventId, "charge.completed:9");
});

// ---- Mock ------------------------------------------------------------------

test("mock provider sends the browser back to our own funding page with the reference", async () => {
  const out = await mockPaymentProvider.initialize({ reference: "PAY-XYZ" });
  assert.match(out.authorizationUrl, /fund\.html\?reference=PAY-XYZ/);
  assert.equal(out.sandbox, true);
});

test("mock verify always reports SUCCESS but never invents an amount", async () => {
  const v = await mockPaymentProvider.verify({ reference: "PAY-XYZ" });
  assert.equal(v.status, "SUCCESS");
  assert.equal(v.amountMinor, null); // corroboration comes from our own row
});
