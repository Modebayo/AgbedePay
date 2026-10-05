// Provider selector — the app imports otpProvider from HERE, so swapping the
// delivery method is a one-line .env change, not a code change.
//
//   SMS_PROVIDER=mock    -> MockOtpProvider  (prints to console; default)
//   SMS_PROVIDER=termii  -> TermiiOtpProvider (real SMS)
//
// If "termii" is selected without its credentials, we fail FAST at import time
// with a clear message instead of letting every OTP silently break.

import { otpProvider as mockProvider } from "./mockOtpProvider.js";
import { TermiiOtpProvider } from "./termiiOtpProvider.js";
import { env } from "../config/env.js";

function buildProvider() {
  if (env.smsProvider === "termii") {
    if (!env.termiiApiKey || !env.termiiSenderId) {
      throw new Error(
        "SMS_PROVIDER=termii requires TERMII_API_KEY and TERMII_SENDER_ID in .env"
      );
    }
    return new TermiiOtpProvider({
      apiKey: env.termiiApiKey,
      senderId: env.termiiSenderId,
      baseUrl: env.termiiBaseUrl,
    });
  }

  // Default and anything unrecognised -> the safe development mock.
  return mockProvider;
}

export const otpProvider = buildProvider();