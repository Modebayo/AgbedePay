// Payment provider selector — the app imports `paymentProvider` from HERE, so
// choosing a gateway is an .env change, not a code change.
//
//   PAYSTACK_SECRET_KEY set    -> Paystack
//   FLUTTERWAVE_SECRET_KEY set -> Flutterwave
//   neither, development       -> Mock (simulated checkout)
//   neither, production        -> Unavailable (every call fails loudly)
//
// That last case is deliberate: a misconfigured production deployment must
// NEVER silently fall back to the mock and credit wallets for free.

import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";
import { PaystackProvider } from "./paystackProvider.js";
import { FlutterwaveProvider } from "./flutterwaveProvider.js";
import { mockPaymentProvider } from "./mockPaymentProvider.js";

function unavailableProvider() {
  const fail = () => {
    throw new ApiError(503, "Payments are not configured", "PAYMENTS_UNCONFIGURED");
  };
  return {
    name: "NONE",
    initialize: fail,
    verify: fail,
    verifyWebhook: () => false,
    parseWebhook: () => ({}),
  };
}

function buildProvider() {
  if (env.paystackSecretKey) {
    return new PaystackProvider({
      secretKey: env.paystackSecretKey,
      publicKey: env.paystackPublicKey,
      baseUrl: env.paystackBaseUrl,
    });
  }
  if (env.flutterwaveSecretKey) {
    return new FlutterwaveProvider({
      secretKey: env.flutterwaveSecretKey,
      publicKey: env.flutterwavePublicKey,
      webhookHash: env.flutterwaveWebhookHash,
      baseUrl: env.flutterwaveBaseUrl,
    });
  }
  if (env.isProduction) return unavailableProvider();
  return mockPaymentProvider;
}

export const paymentProvider = buildProvider();
