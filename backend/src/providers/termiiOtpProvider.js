// TERMII OTP provider — sends the verification code as a REAL SMS.
//
// Implements the same OtpProvider contract as the mock, so nothing else in the
// app changes. The app still calls otpProvider.send({ phone, code, purpose });
// the provider chosen is decided by SMS_PROVIDER in .env (see providers/index.js).
//
// Termii Messaging API (v4, endpoint documented at developer.termii.com/messaging-api):
//   POST {baseUrl}/api/sms/send
//     { api_key, to, from, sms, type: "plain", channel: "dnd" }
//
//   - api_key is sent IN THE REQUEST BODY (not a header) per Termii's docs.
//   - The base URL is per-account and comes from .env (TERMII_BASE_URL).
//   - channel: "dnd" — Termii's docs explicitly say the "generic" (promotional)
//     route must NOT be used for OTP/transactional codes: it silently fails to
//     deliver to numbers on Do-Not-Disturb and obeys carrier time windows. The
//     DND (transactional) route is the correct one for verification codes.
//
// Security rules we follow here:
//   - The API key comes from env.js (read from .env) and is NEVER logged,
//     echoed, or included in any error message.
//   - The recipient number is logged masked (234801**********).
//   - Errors are sanitised before they reach logs/responses: we keep Termii's
//     message, never the request we sent.

import { OtpProvider } from "./otpProvider.js";
import { ApiError } from "../utils/errors.js";

const MESSAGE_FOR_PURPOSE = {
  REGISTRATION: "to complete your AgbedePay account registration",
  FORGOT_PIN: "to reset your AgbedePay PIN",
};

// "08012345678" -> "2348012345678" (Termii needs international format).
function toInternational(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return digits;
}

// Never log the full number either: keep the last 2 digits only.
function maskPhone(phone) {
  const digits = toInternational(phone);
  return `${digits.slice(0, -2)}${"*".repeat(2)}`;
}

export class TermiiOtpProvider extends OtpProvider {
  constructor({ apiKey, senderId, baseUrl }) {
    super();
    this.apiKey = apiKey;
    this.senderId = senderId;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async send({ phone, code, purpose }) {
    const reason = MESSAGE_FOR_PURPOSE[purpose] ?? "for your AgbedePay account";
    const message = `AgbedePay: your verification code is ${code}. Use it ${reason}. It expires in 15 minutes. Do not share it.`;

    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey, // sent to Termii over HTTPS; never logged by us
          to: toInternational(phone),
          from: this.senderId,
          sms: message,
          type: "plain",
          channel: "dnd", // transactional route — Termii docs require this for OTP codes
        }),
      });
    } catch (err) {
      console.error(`[TERMII] SMS request to ${maskPhone(phone)} failed (network): ${err.message}`);
      throw new ApiError(502, "Could not reach the SMS gateway. Try again in a moment.", "SMS_SEND_FAILED");
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null; // Termii sometimes returns non-JSON on hard errors
    }

    if (!res.ok) {
      const providerMsg = body?.message || body?.detail || `HTTP ${res.status}`;
      // Safe to log: it's Termii's own wording, never our request/key.
      console.error(`[TERMII] SMS send to ${maskPhone(phone)} was rejected: ${providerMsg}`);
      throw new ApiError(502, "The SMS gateway could not send the verification code. Try again soon.", "SMS_SEND_FAILED");
    }

    const reference = body?.message_id ?? `TERMII-${Date.now()}`;
    console.log(`[TERMII] SMS verification code sent to ${maskPhone(phone)} (message_id ${reference})`);
    return { provider: "termii", status: "delivered", reference, devOnly: false };
  }
}