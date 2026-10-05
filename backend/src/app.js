import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import healthRouter from "./routes/health.js";
import devRouter from "./routes/devRouter.js";
import authRouter from "./routes/authRouter.js";
import userRouter from "./routes/userRouter.js";
import walletRouter from "./routes/walletRouter.js";
import transferRouter from "./routes/transferRouter.js";
import savingsRouter from "./routes/savingsRouter.js";
import wealthRouter from "./routes/wealthRouter.js";
import marketRouter from "./routes/marketRouter.js";
import kycRouter from "./routes/kycRouter.js";
import airtimeRouter from "./routes/airtimeRouter.js";
import billsRouter from "./routes/billsRouter.js";
import bettingRouter from "./routes/bettingRouter.js";
import notificationsRouter from "./routes/notificationsRouter.js";
import withdrawRouter from "./routes/withdrawRouter.js";
import referralRouter from "./routes/referralRouter.js";
import dispatchRouter from "./routes/dispatchRouter.js";
import rideRouter from "./routes/rideRouter.js";
import placesRouter from "./routes/placesRouter.js";
import supportRouter from "./routes/supportRouter.js";
import { apiNotFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- Security headers ----
app.use(helmet());

// ---- CORS ----
app.use(
  cors({
    origin: env.isProduction ? "https://agbedepay.com" : true,
    credentials: true,
  })
);

// ---- Body parsing ----
app.use(express.json({ limit: "1mb" }));

// ---- Cookies (required for the httpOnly session cookie) ----
app.use(cookieParser());

// ---- API routes ----
app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/transactions", transferRouter);
app.use("/api/savings", savingsRouter);
app.use("/api/wealth", wealthRouter);
app.use("/api/market", marketRouter);
app.use("/api/kyc", kycRouter);
app.use("/api/airtime", airtimeRouter);
app.use("/api/bills", billsRouter);
app.use("/api/betting", bettingRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/withdraw", withdrawRouter);
app.use("/api/referrals", referralRouter);
app.use("/api/dispatch", dispatchRouter);
app.use("/api/ride", rideRouter);
app.use("/api/places", placesRouter);
app.use("/api/support", supportRouter);

// DEV endpoints are NEVER mounted in production.
if (!env.isProduction) {
  app.use("/api/dev", devRouter);
}

// ---- Unknown API routes -> 404 (must come after all real API routes) ----
app.use("/api", apiNotFound);

// ---- Static frontend ----
const frontendDir = path.join(__dirname, "../../frontend");
app.use(express.static(frontendDir));

// ---- Catch-all: serve frontend pages ----
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// ---- Central error handler (must be registered LAST) ----
app.use(errorHandler);

export { app };