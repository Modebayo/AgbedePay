// MOCK dispatch (logistics) provider — DEVELOPMENT ONLY.
// Feeds the package-delivery + errand-service module:
//   - item types and vehicles, with their per-km rates
//   - deterministic fare quotes (never trusted from the client)
//   - a seeded rider pool
//   - deterministic lat/lng for any address (there is no real geo provider)
// The wallet debit + DISPATCH ledger rows are REAL; only the courier network
// is simulated.

import { sha256 } from "../utils/crypto.js";
import { coordsFor, distanceKmBetween } from "../utils/geo.js";

// ---- Product catalogue ------------------------------------------------------

export const ITEM_TYPES = [
  { key: "DOCUMENT", label: "Document / envelope" },
  { key: "SMALL", label: "Small box" },
  { key: "MEDIUM", label: "Medium box" },
  { key: "FRAGILE", label: "Fragile item" },
  { key: "HEAVY", label: "Heavy item" },
];

// Which vehicles may carry which items.
const VEHICLE_HANDLES = {
  DOCUMENT: ["BIKE", "CAR", "VAN"],
  SMALL: ["BIKE", "CAR", "VAN"],
  MEDIUM: ["CAR", "VAN"],
  FRAGILE: ["VAN"],
  HEAVY: ["VAN"],
};

// Per-vehicle economics (all in kobo). base = flag-down, perKm = distance part.
const VEHICLES = {
  BIKE: { key: "BIKE", label: "Bike", baseMinor: 15000, perKmMinor: 2500, etaPerKm: 3, etaBase: 12, maxPassengers: 1 },
  CAR: { key: "CAR", label: "Car", baseMinor: 30000, perKmMinor: 5000, etaPerKm: 3.4, etaBase: 18, maxPassengers: 3 },
  VAN: { key: "VAN", label: "Van", baseMinor: 55000, perKmMinor: 7500, etaPerKm: 4, etaBase: 22, maxPassengers: 6 },
};

// Item weight surcharge (kobo), applied on top of base + distance.
const ITEM_SURCHARGE = {
  DOCUMENT: 0,
  SMALL: 0,
  MEDIUM: 20000,
  FRAGILE: 30000,
  HEAVY: 50000,
};

// ---- Rider pool (all fictional) ---------------------------------------------

const RIDERS = [
  { name: "Emeka O.", phone: "08091010101", vehicle: "Bike", plate: "LAG-01A", rating: 4.8, trips: 312 },
  { name: "Chidi A.", phone: "08091020202", vehicle: "Bike", plate: "LAG-02B", rating: 4.6, trips: 208 },
  { name: "Musa K.", phone: "08091030303", vehicle: "Kia Picanto", plate: "LAG-03C", rating: 4.9, trips: 541 },
  { name: "Femi O.", phone: "08091040404", vehicle: "Toyota Corolla", plate: "LAG-04D", rating: 4.7, trips: 389 },
  { name: "Bola A.", phone: "08091050505", vehicle: "Hilux pickup", plate: "LAG-05E", rating: 4.9, trips: 476 },
  { name: "Yusuf S.", phone: "08091060606", vehicle: "Peugeot 406", plate: "LAG-06F", rating: 4.5, trips: 295 },
];

export function listItemTypes() {
  return ITEM_TYPES;
}

export function listVehicles() {
  return Object.values(VEHICLES).map((v) => ({
    key: v.key,
    label: v.label,
    baseMinor: v.baseMinor,
    perKmMinor: v.perKmMinor,
    ratePerKm: (v.perKmMinor / 100).toFixed(0),
  }));
}

export function vehiclesForItem(itemType) {
  return (VEHICLE_HANDLES[itemType] ?? ["CAR"]).map((key) => VEHICLES[key]);
}

// ---- Distance (deterministic mock geo) --------------------------------------
// Delegated to utils/geo so the mock distance can never disagree with the maps
// service fallback. Re-exported for callers/tests that import it from here.

export { coordsFor, distanceKmBetween };

// ---- Quoting -----------------------------------------------------------------

// baseMinor / perKmMinor may be supplied by the pricing service (DB rule);
// when omitted the built-in vehicle constants are used.
export function quote({ itemType, vehicleType, distanceKm, serviceType, baseMinor: baseOverride, perKmMinor: perKmOverride }) {
  const vehicle = VEHICLES[vehicleType];
  if (!vehicle) throw new Error(`Unknown vehicle ${vehicleType}`);
  if (!VEHICLE_HANDLES[itemType]?.includes(vehicleType)) {
    return { ok: false, reason: "VEHICLE_CANNOT_CARRY", etaMin: null, breakdown: [], totalMinor: 0 };
  }

  const baseMinor = Number.isFinite(baseOverride) ? baseOverride : vehicle.baseMinor;
  const perKmMinor = Number.isFinite(perKmOverride) ? perKmOverride : vehicle.perKmMinor;
  const distanceMinor = Math.round(perKmMinor * distanceKm);
  const weightMinor = ITEM_SURCHARGE[itemType] ?? 0;
  const subTotal = baseMinor + distanceMinor + weightMinor;
  // Round the fare to whole naira — tidy, deterministic, honest.
  const totalMinor = Math.round(subTotal / 100) * 100;

  const m = (n) => (n / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
  const lines = [
    { label: "Base fare", minor: baseMinor, ngn: m(baseMinor) },
    { label: `${distanceKm} km ride`, minor: distanceMinor, ngn: m(distanceMinor) },
  ];
  if (weightMinor > 0) {
    lines.push({ label: `${itemType.toLowerCase()} surcharge`, minor: weightMinor, ngn: m(weightMinor) });
  }
  if (serviceType === "ERRAND") {
    const errand = Math.round(totalMinor * 0.2 / 100) * 100;
    lines.push({ label: "Errand service fee", minor: errand, ngn: m(errand) });
  }

  const serviceMinor = lines.reduce((sum, l) => sum + l.minor, 0);
  const etaMin = Math.ceil(vehicle.etaBase + vehicle.etaPerKm * distanceKm);

  return {
    ok: true,
    reason: null,
    distanceKm,
    etaMin,
    breakdown: lines,
    totalMinor: serviceMinor,
    totalNgn: m(serviceMinor),
  };
}

// A rider for a vehicle class — deterministic pick per vehicle key.
export function assignRider(vehicleType) {
  const pool = RIDERS.filter((r) => r.plate.endsWith(vehicleType === "BIKE" ? "B" : vehicleType === "VAN" ? "E" : "D"));
  const rider = pool[(vehicleType.length + Date.now() % 3) % pool.length] ?? RIDERS[0];
  return { ...rider };
}

// 4-digit code a courier must produce to finalise a DELIVERY. The code is
// DERIVED from the ledger reference (which exists before any row is written),
// so the same code can be re-shown while tracking without storing it raw —
// only its SHA-256 hash ever touches the database.
export function otpFromReference(reference) {
  const hex = sha256(reference).slice(0, 8);
  const code = (Number.parseInt(hex, 16) % 10000).toString().padStart(4, "0");
  return { code, hash: sha256(code) };
}