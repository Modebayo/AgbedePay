// geo controller — maps config, route computation, and a Places autocomplete
// proxy. The browser key is public (restrict it by HTTP referrer); the server
// key that reaches Google's billing stays on the backend.

import { asyncHandler } from "../utils/errors.js";
import { env } from "../config/env.js";
import { computeRoute } from "../services/mapsService.js";

const PLACES_URL = "https://places.googleapis.com/v1/places:autocomplete";

// GET /api/geo/config — tells the frontend whether live maps are on and, if so,
// which browser key + region to use.
export const config = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: env.googleMapsEnabled,
      browserKey: env.googleMapsEnabled ? env.googleMapsBrowserKey : null,
      region: env.googleMapsRegion,
    },
  });
});

// POST /api/geo/route — { origin, destination } → distance/duration/polyline.
export const route = asyncHandler(async (req, res) => {
  const data = await computeRoute({
    origin: req.body.origin,
    destination: req.body.destination,
  });
  res.json({ success: true, data });
});

// GET /api/geo/places?q= — server-side Places Autocomplete proxy, so the server
// key is never exposed and we can region-limit results.
export const places = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? "").trim();

  // Without a key (or a too-short query) return an empty, well-formed result:
  // the frontend then lets the user type a free-text address.
  if (!env.googleMapsEnabled || q.length < 2) {
    return res.json({ success: true, data: { enabled: env.googleMapsEnabled, predictions: [] } });
  }

  try {
    const gRes = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googleMapsServerKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: [String(env.googleMapsRegion).toLowerCase()],
      }),
    });
    if (!gRes.ok) throw new Error(`Places API ${gRes.status}`);
    const data = await gRes.json();
    const predictions = (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        description: p.text?.text ?? "",
        main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return res.json({ success: true, data: { enabled: true, predictions } });
  } catch (err) {
    console.error(`[geo] places lookup failed: ${err.message}`);
    return res.json({ success: true, data: { enabled: true, predictions: [] } });
  }
});
