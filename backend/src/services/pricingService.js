// pricingService — the database-backed fare table.
//
// Fares used to be constants in the mock providers. They now live in the
// `pricing_rules` table so an operator can change them without a deploy, and so
// the platform commission is recorded per rule. This service is deliberately
// RESILIENT: if the table is missing (migration not yet applied) it returns null
// and callers fall back to the provider constants — the app keeps working.

import { query } from "../config/db.js";
import { env } from "../config/env.js";

function toRate(row) {
  if (!row) return null;
  return {
    service: row.service,
    key: row.key,
    label: row.label,
    baseMinor: Number(row.base_minor),
    perKmMinor: Number(row.per_km_minor),
    minFareMinor: Number(row.min_fare_minor),
    surgeThresholdKm: Number(row.surge_threshold_km),
    surgeMultiplier: Number(row.surge_multiplier),
    commissionBp: Number(row.commission_bp),
  };
}

// A single rule for (service, key), or null when absent/unavailable. Never
// throws on a missing table — pricing must not be able to break a booking.
export async function ratesFor(service, key) {
  try {
    const { rows } = await query(
      `SELECT service, key, label, base_minor, per_km_minor, min_fare_minor,
              surge_threshold_km, surge_multiplier, commission_bp
         FROM pricing_rules
        WHERE service = $1 AND key = $2 AND active = true`,
      [service, key]
    );
    return toRate(rows[0]);
  } catch {
    return null;
  }
}

export async function listRules(service) {
  try {
    const { rows } = await query(
      `SELECT service, key, label, base_minor, per_km_minor, min_fare_minor,
              surge_threshold_km, surge_multiplier, commission_bp
         FROM pricing_rules
        WHERE ($1::text IS NULL OR service = $1) AND active = true
        ORDER BY service, key`,
      [service ?? null]
    );
    return rows.map(toRate);
  } catch {
    return [];
  }
}

// Platform commission (kobo) on a gross fare, resolved from the rule when
// present, otherwise the env default. Rounded to whole kobo.
export function commissionFor(grossMinor, rate) {
  const bp = rate?.commissionBp ?? env.platformCommissionBp;
  return Math.round((grossMinor * bp) / 10000);
}
