import pg from "pg";
import { env } from "./env.js";

// pg.Pool manages a pool of reusable connections for you.
// In production, many clients hit the server at once.
// Instead of opening and closing a connection every time,
// we keep a small pool (max: 10) and reuse them.
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
});

// Query helper — runs a parameterised SQL statement.
export async function query(text, params = []) {
  return pool.query(text, params);
}

// Used by the /health endpoint to confirm the DB is reachable.
export async function checkDatabase() {
  const start = Date.now();

  try {
    await pool.query("SELECT 1 AS ok");

    const latencyMs = Date.now() - start;

    return {
      connected: true,
      latencyMs,
    };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

// Graceful shutdown — close all pooled connections before exiting.
export async function closePool() {
  await pool.end();
}