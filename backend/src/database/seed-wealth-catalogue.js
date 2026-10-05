// database/seed-wealth-catalogue.js — apply ONLY the instrument catalogue.
//
// WHY THIS EXISTS SEPARATELY
//
// seed.js is guarded: it refuses to re-run once a wallet's balance has drifted
// from the arithmetic it expects, because a re-seed on a database that holds
// real activity would leave users, wallets and transactions inconsistent with
// each other. That guard is correct and stays.
//
// The consequence, though, is that a dev database which has been used can never
// be re-seeded — and if it was seeded before the Wealth section existed, it has
// no instruments at all, so the Funds, Bonds and Pension pages are permanently
// empty with no safe way to fix them.
//
// The instrument catalogue is REFERENCE DATA. It depends on no user, no wallet
// and no transaction, so it can be applied on its own, safely, to any database.
// That is all this script does.
//
// SAFE TO RUN TWICE. Idempotent, and it deliberately does NOT overwrite
// `unit_price_minor`: once the live NGX feed has written a real quote, a
// re-apply must not snap the price back to the seeded figure. Only
// `maturity_date` is refreshed, because that is the one time-relative value.
//
//   DATABASE_URL=... node backend/src/database/seed-wealth-catalogue.js

import { pool } from "../config/db.js";
import { applyCatalogue, INSTRUMENTS } from "./wealthCatalogue.js";

const client = await pool.connect();
try {
  // Refuse to run before the column exists. Without this the failure is a raw
  // Postgres error about a missing column, which reads like a broken script
  // rather than "run npm run db:migrate first".
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'wealth_instruments' AND column_name = 'maturity_date'`
  );
  if (rows.length === 0) {
    throw new Error(
      "wealth_instruments.maturity_date does not exist. Run `npm run db:migrate` first."
    );
  }

  const before = await client.query(
    "SELECT count(*)::int AS c FROM wealth_instruments WHERE status = 'ACTIVE'"
  );

  const result = await applyCatalogue(client);

  const byClass = await client.query(
    `SELECT class, count(*)::int AS c
       FROM wealth_instruments WHERE status = 'ACTIVE'
      GROUP BY class ORDER BY class`
  );

  const withMaturity = await client.query(
    "SELECT count(*)::int AS c FROM wealth_instruments WHERE class = 'BOND' AND maturity_date IS NOT NULL"
  );

  console.log(
    `Wealth catalogue applied: ${result.inserted} rows written ` +
      `(${before.rows[0].c} active instruments before, ${byClass.rows.length} classes now).`
  );
  console.log(`  ${byClass.rows.map((r) => `${r.class}:${r.c}`).join("  ")}`);
  console.log(`  bonds with a maturity date: ${withMaturity.rows[0].c} of ${INSTRUMENTS.filter((i) => i[3] === "BOND").length}`);
  console.log("  No user, wallet, holding, order or transaction data was touched.");
} catch (err) {
  console.error(`Catalogue backfill failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
