// /health — the endpoint a load balancer, container orchestrator or reverse
// proxy polls to decide whether this process is usable.
//
// During a 502 outage this is the first thing worth curling, so it reports WHY
// the app is unhealthy instead of only that it is. It is also deliberately
// outside requireAuth: a health check that can 401 is a health check a load
// balancer will eventually mark the instance down.
//
// It must never throw. If the dependency probe below fails, that is reported as
// data, not as a 500 — an endpoint that crashes cannot explain the crash.

import { Router } from "express";
import { createRequire } from "node:module";
import { checkDatabase } from "../config/db.js";

const router = Router();

// Probed with a lazy require rather than a top-level import, for the same
// reason uploadAvatar.js does it: a missing package must never prevent this
// module from loading. The failed upload incident (a missing `multer` took down
// every route including /health) is exactly the failure mode being guarded
// against here.
function probeDependency(name) {
  try {
    const require = createRequire(import.meta.url);
    require.resolve(name);
    return { name, installed: true };
  } catch {
    return { name, installed: false };
  }
}

router.get("/", async (_req, res) => {
  const db = await checkDatabase().catch((err) => ({
    connected: false,
    error: err?.message ?? "health probe threw",
  }));

  // Optional features. A false here means the app is degraded but serving,
  // which is a different operational response to a false on `db`.
  const dependencies = [probeDependency("multer")];

  const missing = dependencies.filter((d) => !d.installed).map((d) => d.name);

  // 200 while the core app works, even if a feature dependency is absent, so a
  // missing upload library cannot get the instance pulled out of rotation.
  // 503 only when the thing that makes the app useless — the database — is gone.
  const healthy = Boolean(db.connected);
  const status = healthy ? "ok" : "unhealthy";

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      service: "agbedepay",
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      db,
      dependencies,
      // A plain-language summary, because reading JSON on an incident is
      // tedious and "degraded" tells an operator nothing actionable.
      ...(missing.length ? { degradedFeatures: missing } : {}),
      hint: missing.length
        ? `Run \`npm install\` on the server. Missing: ${missing.join(", ")}. Other routes are unaffected.`
        : undefined,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;