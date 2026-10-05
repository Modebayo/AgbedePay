import { app } from "./src/app.js";
import { env } from "./src/config/env.js";
import { closePool } from "./src/config/db.js";

const server = app.listen(env.port, () => {
  console.log(`\n🚀  AgbedePay server running on http://localhost:${env.port}`);
  console.log(`    Environment : ${env.nodeEnv}`);
  console.log(`    Health check: http://localhost:${env.port}/health`);
  console.log(`    Database    : ${env.databaseUrl ? "configured" : "not configured"}`);
  console.log("");
});

// ---- Graceful shutdown ----
// When the process receives SIGTERM / Ctrl+C, close open connections
// before exiting so the OS can reclaim the port cleanly.
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down…`);
  server.close(async () => {
    await closePool();
    console.log("All connections closed. Goodbye.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));