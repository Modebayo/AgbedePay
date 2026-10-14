import dotenv from "dotenv";
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get port() {
    return Number(process.env.PORT ?? 3000);
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? null;
  },
  get sessionTtlMs() {
    return Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000); // 7 days
  },
  // OTP delivery provider. Defaults to the mock (prints to the server console);
  // set to "termii" to send real SMS (requires TERMII_API_KEY + TERMII_SENDER_ID).
  get smsProvider() {
    return process.env.SMS_PROVIDER ?? "mock";
  },
  get termiiApiKey() {
    return process.env.TERMII_API_KEY ?? "";
  },
  get termiiSenderId() {
    return process.env.TERMII_SENDER_ID ?? "";
  },
  get termiiBaseUrl() {
    // Your per-account base URL is shown on the Termii dashboard (v4 accounts
    // use something like https://v4.api.termii.com). Override in .env.
    return process.env.TERMII_BASE_URL ?? "https://v4.api.termii.com";
  },
  // Public base URL of this deployment, used to build provider callback/webhook
  // URLs. Falls back to localhost in development.
  get appBaseUrl() {
    return (process.env.APP_BASE_URL ?? `http://localhost:${this.port}`).replace(/\/+$/, "");
  },
  // ---- Google Maps / Routes ----
  // Browser key is embedded in the frontend (restrict it by HTTP referrer).
  // Server key stays on the backend (restrict by IP; enable Routes API).
  // When EITHER is absent the app falls back to a deterministic mock route —
  // so the product works with no key and upgrades the moment one is added.
  get googleMapsBrowserKey() {
    return process.env.GOOGLE_MAPS_BROWSER_KEY ?? "";
  },
  get googleMapsServerKey() {
    return process.env.GOOGLE_MAPS_SERVER_KEY ?? "";
  },
  get googleMapsRegion() {
    return process.env.GOOGLE_MAPS_REGION ?? "NG";
  },
  get googleMapsEnabled() {
    return Boolean(this.googleMapsBrowserKey && this.googleMapsServerKey);
  },
  // Default platform commission (basis points) when a driver profile / pricing
  // rule does not specify its own. 1500 = 15%.
  get platformCommissionBp() {
    return Number(process.env.PLATFORM_COMMISSION_BP ?? 1500);
  },
  // ---- Paystack (test mode) ----
  get paystackSecretKey() {
    return process.env.PAYSTACK_SECRET_KEY ?? "";
  },
  get paystackPublicKey() {
    return process.env.PAYSTACK_PUBLIC_KEY ?? "";
  },
  get paystackBaseUrl() {
    return process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co";
  },
  // ---- Flutterwave (scaffold) ----
  get flutterwaveSecretKey() {
    return process.env.FLUTTERWAVE_SECRET_KEY ?? "";
  },
  get flutterwavePublicKey() {
    return process.env.FLUTTERWAVE_PUBLIC_KEY ?? "";
  },
  get flutterwaveWebhookHash() {
    return process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? "";
  },
  get flutterwaveBaseUrl() {
    return process.env.FLUTTERWAVE_BASE_URL ?? "https://api.flutterwave.com/v3";
  },
  get paymentsEnabled() {
    return Boolean(this.paystackSecretKey || this.flutterwaveSecretKey);
  },
};