// Lightweight migration runner.
// Reads backend/src/database/migrations/*.sql in name order and applies each
// file that hasn't been applied yet. Applied files are tracked in a
// schema_migrations table. Each file runs inside its own transaction so a
// half-failed migration can never happen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

async function runMigrations() {
  // Create the bookkeeping table if needed.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const appliedResult = await pool.query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedResult.rows.map((r) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // alphabetical = the order we numbered them

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  [skip]  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // No parameters => multi-statement SQL is allowed by the driver.
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  [ ok ]  ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  [FAIL]  ${file}\n         ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("\nAll migrations applied.");
}

runMigrations()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });