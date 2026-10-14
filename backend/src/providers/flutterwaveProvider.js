// Flutterwave payment provider — scaffolded behind the same interface as
// Paystack, so switching providers is an .env choice, not a rewrite.
//
// NOTE the unit difference: Flutterwave expects MAJOR units (naira), so amounts
// crossing this boundary are converted (÷100 out, ×100 back). Internally the
// app stays in integer kobo. API docs:
// https://developer.flutterwave.com/docs/collecting-payments/standard

import { ApiError } from "../utils/errors.js";

const TIMEOUT_MS = 15_000;

async function call(url, { method = "GET", secretKey, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      throw new ApiError(502, json?.message || "Payment provider error", "PROVIDER_ERROR");
    }
    return json;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === "AbortError") {
      throw new ApiError(504, "Payment provider timed out", "PROVIDER_TIMEOUT");
    }
    throw new ApiError(502, "Could not reach payment provider", "PROVIDER_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
}

export class FlutterwaveProvider {
  constructor({ secretKey, publicKey, webhookHash, baseUrl }) {
    this.name = "FLUTTERWAVE";
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    this.webhookHash = webhookHash;
    this.baseUrl = baseUrl;
  }

  async initialize({ email, amountMinor, reference, callbackUrl, metadata }) {
    const json = await call(`${this.baseUrl}/payments`, {
      method: "POST",
      secretKey: this.secretKey,
      body: {
        tx_ref: reference,
        amount: (amountMinor / 100).toFixed(2), // major units
        currency: "NGN",
        redirect_url: callbackUrl,
        customer: { email },
        meta: metadata,
      },
    });
    const d = json.data ?? {};
    return {
      authorizationUrl: d.link ?? null,
      accessCode: null,
      providerRef: reference,
      sandbox: false,
    };
  }

  async verify({ reference }) {
    const json = await call(
      `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { secretKey: this.secretKey }
    );
    const d = json.data ?? {};
    return {
      status: statusFromFlutterwave(d.status),
      amountMinor: typeof d.amount === "number" ? Math.round(d.amount * 100) : null,
      providerRef: d.id != null ? String(d.id) : null,
      raw: d,
    };
  }

  // Flutterwave webhooks carry a static secret hash in the `verif-hash` header
  // (not an HMAC of the body) — compared as a plain secret.
  verifyWebhook({ headers }) {
    const hash = headers["verif-hash"];
    return Boolean(this.webhookHash) && hash === this.webhookHash;
  }

  parseWebhook(body) {
    const event = body?.event ?? body?.["event.type"] ?? "unknown";
    const d = body?.data ?? {};
    return {
      eventId: `${event}:${d.id ?? d.tx_ref ?? "na"}`,
      eventType: event,
      reference: d.tx_ref ?? null,
      status: statusFromFlutterwave(d.status),
      amountMinor: typeof d.amount === "number" ? Math.round(d.amount * 100) : null,
      providerRef: d.id != null ? String(d.id) : null,
    };
  }
}

function statusFromFlutterwave(status) {
  if (status === "successful" || status === "success") return "SUCCESS";
  if (status === "failed" || status === "cancelled") return "FAILED";
  return "PENDING";
}
