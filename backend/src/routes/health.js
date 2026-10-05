import { Router } from "express";
import { checkDatabase } from "../config/db.js";

const router = Router();

router.get("/", async (_req, res) => {
  const db = await checkDatabase();

  res.json({
    success: true,
    data: {
      service: "agbedepay",
      status: db.connected ? "ok" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      db,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;