// MOCK ride-hailing provider — DEVELOPMENT ONLY.
// Feeds the ride module: Economy / Comfort / Bargain tiers, deterministic fare
// quotes (never trusted from the client), a seeded driver pool, and the
// Bargain accept/decline decision. The wallet debit + RIDE ledger rows are
// REAL; only the driver network is simulated.

// ---- Tiers ------------------------------------------------------------------

const TIERS = {
  ECONOMY: { key: "ECONOMY", label: "Economy", baseMinor: 30000, perKmMinor: 10000, etaPerKm: 3.2, etaBase: 10, maxPassengers: 4 },
  COMFORT: { key: "COMFORT", label: "Comfort", baseMinor: 50000, perKmMinor: 16000, etaPerKm: 3.5, etaBase: 12, maxPassengers: 4 },
  BARGAIN: { key: "BARGAIN", label: "Bargain", baseMinor: 25000, perKmMinor: 8000, etaPerKm: 4, etaBase: 14, maxPassengers: 1 },
};

export function listTiers() {
  return Object.values(TIERS).map((t) => ({
    key: t.key,
    label: t.label,
    baseMinor: t.baseMinor,
    perKmMinor: t.perKmMinor,
    ratePerKm: (t.perKmMinor / 100).toFixed(0),
    maxPassengers: t.maxPassengers,
  }));
}

// ---- Driver pool (all fictional) ---------------------------------------------

const DRIVERS = [
  { name: "Adaeze N.", phone: "08092010101", car: "Sienna", color: "Silver", plate: "LAG-77K", rating: 4.9, trips: 1204 },
  { name: "Tunde B.", phone: "08092020202", car: "Honda Accord", color: "Black", plate: "LAG-12M", rating: 4.8, trips: 876 },
  { name: "Ifeoma E.", phone: "08092030303", car: "Camry", color: "White", plate: "LAG-31P", rating: 4.7, trips: 655 },
  { name: "Seun A.", phone: "08092040404", car: "SUV GLK", color: "Navy", plate: "LAG-09R", rating: 4.9, trips: 1420 },
  { name: "Kingsley O.", phone: "08092050505", car: "Corolla", color: "Blue", plate: "LAG-50S", rating: 4.6, trips: 542 },
  { name: "Hauwa M.", phone: "08092060606", car: "Kia Rio", color: "Red", plate: "LAG-24T", rating: 4.8, trips: 990 },
];

// ---- Distance (deterministic mock geo) --------------------------------------

export function coordsFor(address) {
  const s = String(address ?? "").trim().toLowerCase();
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 31 + c) >>> 0;
    h2 = (h2 * 17 + c + 7) >>> 0;
  }
  const lat = 6.42 + (h1 % 100) / 1000;
  const lng = 3.34 + (h2 % 100) / 1000;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function haversineKm(a, b) {
  const toRad = (n) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanceKmBetween(pickup, dropoff) {
  const km = haversineKm(coordsFor(pickup), coordsFor(dropoff));
  return Math.max(1, Number(km.toFixed(2)));
}

// ---- Quote -------------------------------------------------------------------

// Deterministic surge: long hauls and odd road-use skew the factor, so the UI
// shows a traffic/demand line that is always reproducible in tests.
function surgeFactor(distanceKm) {
  if (distanceKm > 15) return 1.2;
  if (distanceKm > 10) return 1.1;
  return 1.0;
}

export function quote({ tier, distanceKm, passengers }) {
  const t = TIERS[tier];
  if (!t) throw new Error(`Unknown tier ${tier}`);
  if (passengers > t.maxPassengers) {
    return { ok: false, reason: "TOO_MANY_PASSENGERS", etaMin: null, breakdown: [], totalMinor: 0 };
  }

  const surge = surgeFactor(distanceKm);
  const baseMinor = t.baseMinor;
  const distanceMinor = Math.round(t.perKmMinor * distanceKm);
  const surgeMinor = Math.round((baseMinor + distanceMinor) * (surge - 1));
  const passengerMinor = tier === "BARGAIN" ? 0 : Math.max(0, passengers - 1) * 10000;
  const subTotal = baseMinor + distanceMinor + surgeMinor + passengerMinor;
  const totalMinor = Math.round(subTotal / 100) * 100;
  const etaMin = Math.ceil(t.etaBase + t.etaPerKm * distanceKm);

  const m = (n) => (n / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
  const lines = [
    { label: "Base fare", minor: baseMinor, ngn: m(baseMinor) },
    { label: `${distanceKm} km ride`, minor: distanceMinor, ngn: m(distanceMinor) },
  ];
  if (surgeMinor > 0) {
    lines.push({ label: "Traffic & demand", minor: surgeMinor, ngn: m(surgeMinor) });
  }
  if (passengerMinor > 0) {
    lines.push({ label: `${passengers} passengers`, minor: passengerMinor, ngn: m(passengerMinor) });
  }

  return {
    ok: true,
    reason: null,
    distanceKm,
    etaMin,
    surge,
    breakdown: lines,
    totalMinor,
    totalNgn: m(totalMinor),
  };
}

// The Bargain decision is a simple math rule (no randomness → testable):
// a driver accepts any offer at or above 80% of the computer fare.
export function evaluateBargain({ offerMinor, quoteMinor, currency = "NGN" }) {
  const threshold = Math.round(quoteMinor * 0.8);
  return { accepted: offerMinor >= threshold };
}

export function matchDriver(tier) {
  const offset = tier.length % DRIVERS.length;
  const driver = DRIVERS[offset];
  return { ...driver };
}