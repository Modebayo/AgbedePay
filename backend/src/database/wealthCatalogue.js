// database/wealthCatalogue.js — the investable instrument catalogue.
//
// This is its own module, not a block inside seed.js, because the catalogue is
// REFERENCE DATA. It depends on no user, no wallet and no transaction, which
// means it can be applied to any database — including one that already has real
// activity in it and whose full seed can no longer run.
//
// That situation is not hypothetical: seed.js deliberately refuses to re-run
// once a wallet's balance has drifted from the arithmetic it expects (see the
// guard in seed.js). A dev database that has been used therefore cannot be
// re-seeded, and without this module its Funds, Bonds and Pension pages would
// be permanently empty with no safe way to fix them. seed-wealth-catalogue.js
// applies just this file, which is idempotent and touches no user data.
//
// Keep the two in sync by IMPORTING from here, never by copying.

/**
 * A DATE relative to the moment the catalogue is applied, not a fixed literal.
 * A hard-coded maturity makes "1.2 years to go" quietly wrong every time the
 * catalogue is re-applied, and a bond page that lies about how long is left is
 * worse than no bond page at all. Returns a plain yyyy-mm-dd for a DATE column.
 */
export function dateInYears(n) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

// The instrument catalogue. STOCK prices are the real NGX quotes the live feed
// returns (30-min delayed, as NGX publishes them free), so a fresh seed and a
// fresh fetch agree. Everything else is an INDICATIVE rate: there is no keyless
// feed for FGN paper or fund NAVs, and is_live = FALSE says so honestly.
//
// The last column is the maturity date, and it is NULL for every class that
// never matures. That null is meaningful rather than missing data: equities and
// open-ended funds genuinely have no maturity, and the Bonds page is written to
// omit the line instead of printing a blank one.
export const INSTRUMENTS = [
  // ---- NGX equities (live feed) ----
  ["d0000000-0000-4000-8000-000000000001", "MTNN", "MTN Nigeria Communications Plc", "STOCK", "MTN Group", "Communications", 86300, 85500, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000002", "DANGCEM", "Dangote Cement Plc", "STOCK", "Dangote Industries", "Non-Energy Minerals", 106670, 106670, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000003", "ZENITHBANK", "Zenith Bank Plc", "STOCK", "Zenith Group", "Finance", 13430, 13490, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000004", "UBA", "United Bank for Africa Plc", "STOCK", "UBA Group", "Finance", 4560, 4520, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000005", "GTCO", "Guaranty Trust Holding Company Plc", "STOCK", "GT Holdings", "Finance", 13700, 13700, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000006", "ARADEL", "Aradel Holdings Plc", "STOCK", "Aradel Resources", "Energy Minerals", 153000, 153000, null, "HIGH", true, null],
  ["d0000000-0000-4000-8000-000000000007", "AIRTELAFRI", "Airtel Africa Plc", "STOCK", "Airtel Africa", "Communications", 630000, 630000, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000008", "BUAFOODS", "BUA Foods Plc", "STOCK", "BUA Group", "Process Industries", 76060, 76060, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000009", "BUACEMENT", "BUA Cement Plc", "STOCK", "BUA Group", "Non-Energy Minerals", 29700, 29700, null, "MEDIUM", true, null],
  ["d0000000-0000-4000-8000-000000000010", "SEPLAT", "Seplat Energy Plc", "STOCK", "Seplat Energy", "Energy Minerals", 1600010, 1600010, null, "HIGH", true, null],
  ["d0000000-0000-4000-8000-000000000011", "FIRSTHOLDCO", "First Holdings Company Plc", "STOCK", "First Group", "Finance", 15990, 15660, null, "MEDIUM", true, null],

  // ---- FGN treasury & bonds (INDICATIVE — no keyless live feed) ----
  // A 91-day bill and a ~5-year and ~7-year bond. Priced at ₦1.00 because that is
  // how treasury paper is quoted: you buy units of face value and collect the
  // return at maturity, not a price that ticks all day.
  ["d0000000-0000-4000-8000-000000000012", "FGN-TB-91", "FGN Treasury Bill (91-day)", "BOND", "Federal Government of Nigeria", "Government Securities", 100, null, 15.5, "LOW", false, dateInYears(0)],
  ["d0000000-0000-4000-8000-000000000013", "FGN-BOND-2031", "FGN Bond due 2031", "BOND", "Federal Government of Nigeria", "Government Securities", 100, null, 18.2, "MEDIUM", false, dateInYears(5)],
  ["d0000000-0000-4000-8000-000000000014", "FGN-BOND-2033", "FGN Bond due 2033", "BOND", "Federal Government of Nigeria", "Government Securities", 100, null, 19.75, "MEDIUM", false, dateInYears(7)],

  // ---- Pension (INDICATIVE) ----
  ["d0000000-0000-4000-8000-000000000015", "PEN-PBS-A", "AgbedePay Pension Fund — Class A", "PENSION", "AgbedePay Pension Managers", "Pension", 12500, null, 13.1, "MEDIUM", false, null],
  ["d0000000-0000-4000-8000-000000000016", "PEN-PBS-B", "AgbedePay Pension Fund — Class B", "PENSION", "AgbedePay Pension Managers", "Pension", 12500, null, 14.85, "HIGH", false, null],

  // ---- Funds & investments (INDICATIVE) ----
  ["d0000000-0000-4000-8000-000000000017", "FUND-MONEY", "AgbedePay Money Market Fund", "FUND", "AgbedePay Asset Management", "Fixed Income", 10300, null, 17.4, "LOW", false, null],
  ["d0000000-0000-4000-8000-000000000018", "FUND-BALANCED", "AgbedePay Balanced Fund", "FUND", "AgbedePay Asset Management", "Mixed Asset", 11850, null, 16.2, "MEDIUM", false, null],
  ["d0000000-0000-4000-8000-000000000019", "FUND-EQUITY", "AgbedePay Equity Fund", "FUND", "AgbedePay Asset Management", "Equity", 14200, null, 21.6, "HIGH", false, null],
];

// Re-runs are safe. Only `maturity_date` is refreshed on conflict, because that
// is the one column whose value is time-relative (see dateInYears) and so the
// one that must not be frozen at whatever the first run happened to compute.
// Prices are deliberately NOT overwritten: once the live feed has written a real
// quote, re-applying the catalogue must not snap it back to the seeded figure.
export const UPSERT_INSTRUMENT = `
  INSERT INTO wealth_instruments
    (id, symbol, name, class, issuer, sector, unit_price_minor, prev_close_minor,
     yield_pct, risk_level, is_live, priced_at, maturity_date)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12::date)
  ON CONFLICT (id) DO UPDATE SET maturity_date = EXCLUDED.maturity_date`;

/**
 * Applies the catalogue to an existing database. Idempotent, and touches no
 * user, wallet, holding or transaction data.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} db
 * @returns {Promise<{inserted: number, updated: number}>}
 */
export async function applyCatalogue(db) {
  let inserted = 0;
  let updated = 0;

  for (const [id, symbol, name, klass, issuer, sector, price, prevClose, yieldPct, risk, isLive, maturity] of INSTRUMENTS) {
    const { rowCount } = await db.query(UPSERT_INSTRUMENT, [
      id, symbol, name, klass, issuer, sector, price, prevClose, yieldPct, risk, isLive, maturity,
    ]);
    // rowCount is 1 for both an insert and an update, so report the totals
    // honestly rather than guessing which happened.
    if (rowCount === 1) inserted += 1;
  }

  const { rows } = await db.query(
    "SELECT count(*)::int AS c FROM wealth_instruments WHERE status = 'ACTIVE'"
  );
  return { inserted, updated: rows[0].c - inserted };
}
