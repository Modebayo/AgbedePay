// Paystack payment provider — hosted checkout for wallet funding.
//
// Amounts are integer KOBO (Paystack's NGN subunit), matching the rest of the
// app, so no conversion happens here. All network errors are normalised into
// ApiError so callers get a consistent envelope. API docs:
// https://paystack.com/docs/api/transaction/

import crypto from "node:crypto";
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

export class PaystackProvider {
  constructor({ secretKey, publicKey, baseUrl }) {
    this.name = "PAYSTACK";
    this.secretKey = secretKey;
    this.publicKey = publicKey;
    this.baseUrl = baseUrl;
  }

  async initialize({ email, amountMinor, reference, callbackUrl, metadata }) {
    const json = await call(`${this.baseUrl}/transaction/initialize`, {
      method: "POST",
      secretKey: this.secretKey,
      body: {
        email,
        amount: amountMinor, // kobo
        reference,
        callback_url: callbackUrl,
        metadata,
      },
    });
    const d = json.data ?? {};
    return {
      authorizationUrl: d.authorization_url ?? null,
      accessCode: d.access_code ?? null,
      providerRef: reference,
      sandbox: false,
    };
  }

  async verify({ reference }) {
    const json = await call(
      `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
      { secretKey: this.secretKey }
    );
    const d = json.data ?? {};
    return {
      status: statusFromPaystack(d.status),
      amountMinor: typeof d.amount === "number" ? d.amount : null,
      providerRef: d.id != null ? String(d.id) : null,
      raw: d,
    };
  }

  verifyWebhook({ rawBody, headers }) {
    const signature = headers["x-paystack-signature"];
    if (!signature) return false;
    const expected = crypto.createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(signature), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(body) {
    const event = body?.event ?? "unknown";
    const d = body?.data ?? {};
    return {
      eventId: `${event}:${d.id ?? d.reference ?? "na"}`,
      eventType: event,
      reference: d.reference ?? null,
      status: statusFromPaystack(d.status),
      amountMinor: typeof d.amount === "number" ? d.amount : null,
      providerRef: d.id != null ? String(d.id) : null,
    };
  }
}

function statusFromPaystack(status) {
  if (status === "success") return "SUCCESS";
  if (status === "failed" || status === "reversed") return "FAILED";
  return "PENDING";
}
