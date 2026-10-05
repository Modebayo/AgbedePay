// OTP provider CONTRACT (interface).
//
// Keep this abstract: the rest of the app only knows about send().
// Swapping the mock for a real SMS provider means implementing this class and
// changing ONE file (mockOtpProvider.js) — nothing else gets rewritten.

export class OtpProvider {
  async send({ phone, code, purpose }) {
    throw new Error("OtpProvider.send() must be implemented by a concrete provider");
  }
}