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
};