// Deterministic mock geo — the fallback when no Google Maps key is configured.
// Every address maps to a STABLE point near Lagos, so quotes are reproducible in
// tests and dev. This is a leaf utility on purpose: both the ride/dispatch mock
// providers and the maps service import it, so the fallback distance can never
// drift between them.

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

export function haversineKm(a, b) {
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

// The road distance used by quotes AND bookings — always recomputed server-side
// from the two addresses. Never accept a distance from the client.
export function distanceKmBetween(pickup, dropoff) {
  const km = haversineKm(coordsFor(pickup), coordsFor(dropoff));
  return Math.max(1, Number(km.toFixed(2)));
}
