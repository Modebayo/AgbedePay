// Mock payment provider — DEVELOPMENT ONLY.
//
// Used when no real gateway keys are configured and we are not in production.
// It stands in for a hosted checkout: `initialize` returns a URL back to our
// own funding page, and `verify` always reports SUCCESS, so the full
// initiate → redirect → verify → settle loop can be exercised end-to-end
// without touching a real gateway. Production never reaches this file (see
// provider selector): with no keys it uses an "unavailable" provider instead.

import { env } from "../config/env.js";

export const mockPaymentProvider = {
  name: "MOCK",

  async initialize({ reference }) {
    return {
      authorizationUrl: `${env.appBaseUrl}/pages/fund.html?reference=${encodeURIComponent(reference)}&sandbox=1`,
      accessCode: null,
      providerRef: `MOCK_${reference}`,
      sandbox: true,
    };
  },

  async verify({ reference }) {
    // The amount is taken from our own payment row, so returning null here is
    // correct: there is no third party to corroborate it in dev.
    return { status: "SUCCESS", amountMinor: null, providerRef: `MOCK_${reference}`, raw: { mock: true } };
  },

  verifyWebhook() {
    return true;
  },

  parseWebhook(body) {
    const d = body ?? {};
    return {
      eventId: `mock:${d.reference ?? Date.now()}`,
      eventType: "charge.success",
      reference: d.reference ?? null,
      status: "SUCCESS",
      amountMinor: null,
      providerRef: null,
    };
  },
};
