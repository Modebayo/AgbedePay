// MOCK OTP provider — DEVELOPMENT ONLY.
//
// It does NOT send an SMS. It prints the code to the server console so the
// verification flow can be tested without a real SMS provider.
// The printed code is clearly labeled as a development mock.
//
// When a real SMS provider (Twilio, Termii, …) is added, implement the same
// OtpProvider contract here and call the provider's API instead.

import { OtpProvider } from "./otpProvider.js";

export class MockOtpProvider extends OtpProvider {
  async send({ phone, code, purpose }) {
    console.log(
      `\n[DEV/MOCK OTP] purpose=${purpose} phone=${phone} code=${code}\n` +
        `                (No SMS was sent — this is a development mock only.)`
    );
    return {
      provider: "mock-otp",
      status: "delivered",
      reference: `MOCK-OTP-${Date.now()}`,
      devOnly: true,
    };
  }
}

export const otpProvider = new MockOtpProvider();