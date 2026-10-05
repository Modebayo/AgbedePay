// Creates the `agbedepay` database if it doesn't exist yet.
// PostgreSQL can't CREATE DATABASE from a parameterised query, and it must be
// run from the maintenance database "postgres", so here we:
//   1) take DATABASE_URL (which points at agbedepay)
//   2) temporarily point at /postgres
//   3) run CREATE DATABASE IF MISSING (quoted identifier, own name only)
import { Client } from "pg";
import { env } from "../config/env.js";

if (!env.databaseUrl) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const url = new URL(env.databaseUrl);
const dbName = url.pathname.replace(/^\//, "");

// Identifiers can't use $1 parameters, so safely build one our own way.
const quoted = dbName.replace(/"/g, '""');

url.pathname = "/postgres";

const client = new Client({ connectionString: url.toString() });

try {
  await client.connect();
  const { rows } = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName]
  );
  if (rows.length > 0) {
    console.log(`Database "${dbName}" already exists.`);
  } else {
    await client.query(`CREATE DATABASE "${quoted}"`);
    console.log(`Created database "${dbName}".`);
  }
} catch (err) {
  console.error("Could not create database — is DATABASE_URL correct and is PostgreSQL running?");
  console.error(`  ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}