// mapsService — the single place route distance/duration/polyline is computed.
//
// With a Google Maps server key configured it calls the Routes API
// (computeRoutes). Without one it falls back to the deterministic mock geo, so
// the whole product works with no key and transparently upgrades the moment a
// key is added. Callers never know which path ran except via `source`.
//
// The CLIENT never supplies a distance — this service derives it from the two
// addresses/points, which is what makes the fare server-authoritative.

import { env } from "../config/env.js";
import { coordsFor, haversineKm } from "../utils/geo.js";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Normalise an endpoint into what the Routes API wants. Accepts:
//   - a string address
//   - { lat, lng } (or lat/lng numbers)
// Returns { asAddress } | { asLatLng }, plus canonical coords if we can derive them.
function toWaypoint(input) {
  if (input && typeof input === "object") {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { api: { location: { latLng: { latitude: lat, longitude: lng } } }, coords: { lat, lng } };
    }
  }
  const address = String(input ?? "").trim();
  return { api: { address }, coords: coordsFor(address) };
}

// Mock route: straight-line haversine at the deterministic coords, with a
// believable road-following duration (≈ avg 24 km/h in Lagos traffic).
function mockRoute(originCoords, destinationCoords) {
  const km = haversineKm(originCoords, destinationCoords);
  const distanceKm = Math.max(1, Number(km.toFixed(2)));
  const durationMin = Math.max(5, Math.ceil((distanceKm / 24) * 60));
  return { distanceKm, durationMin, polyline: null, source: "mock" };
}

async function googleRoute(origin, destination) {
  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.googleMapsServerKey,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: origin.api,
      destination: destination.api,
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      regionCode: env.googleMapsRegion,
      units: "METRIC",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Routes API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("Routes API returned no route");

  const distanceKm = Number((route.distanceMeters / 1000).toFixed(2));
  // duration is like "1234s".
  const durationSec = Number(String(route.duration).replace("s", ""));
  const durationMin = Math.max(1, Math.ceil(durationSec / 60));
  const polyline = route.polyline?.encodedPolyline ?? null;
  return { distanceKm, durationMin, polyline, source: "google" };
}

// Compute a route between two addresses/points. Falls back to mock on ANY
// Google failure (missing key, quota, network) so a Maps outage can never stop
// someone booking a ride — it just costs accuracy.
export async function computeRoute({ origin, destination }) {
  const o = toWaypoint(origin);
  const d = toWaypoint(destination);

  if (env.googleMapsEnabled) {
    try {
      const route = await googleRoute(o, d);
      return { ...route, origin: o.coords, destination: d.coords };
    } catch (err) {
      // Swallow and fall back; log for operators.
      console.error(`[maps] Google route failed, using mock: ${err.message}`);
    }
  }
  return { ...mockRoute(o.coords, d.coords), origin: o.coords, destination: d.coords };
}

// Convenience for callers that only need the coords (e.g. storing a booking).
export function coords(addressOrPoint) {
  return toWaypoint(addressOrPoint).coords;
}
