// maps.js — shared Google Maps integration for the Ride and Logistics pages.
//
// Design goals:
//   - Works with NO key: every method is a safe no-op and tells the caller
//     (via AgbeMaps.enabled()) whether live maps are available, so pages can
//     fall back to their CSS route rail.
//   - Lazily loads the Google Maps JS API only when a key is configured.
//   - Never trusts the client with money: distance comes from the backend
//     (/geo/route). The map is purely presentational.
//
// Public API (window.AgbeMaps):
//   enabled()  -> Promise<boolean>          live maps available?
//   initMap(el, opts) -> Promise<Map|null>  mount a map into a container
//   drawRoute(map, route) -> void           draw pickup/dropoff + polyline
//   autocomplete(input, onSelect) -> void   Places-backed address suggestions

(function () {
  "use strict";

  const { api } = window.AgbeAPI;

  let cfgPromise = null;
  let sdkPromise = null;

  function getConfig() {
    if (!cfgPromise) {
      cfgPromise = api("/geo/config")
        .then((data) => data)
        .catch(() => ({ enabled: false, browserKey: null, region: "NG" }));
    }
    return cfgPromise;
  }

  // Inject the Google Maps SDK once. Resolves true when window.google.maps is
  // ready, false if it cannot be loaded (bad key/offline) — callers then fall
  // back to the CSS rail instead of showing a broken map.
  function loadSdk(browserKey) {
    if (window.google && window.google.maps) return Promise.resolve(true);
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise((resolve) => {
      const cbName = "__agbeMapsReady";
      window[cbName] = () => resolve(true);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(browserKey)}&libraries=places&loading=async&callback=${cbName}`;
      s.async = true;
      s.defer = true;
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  async function enabled() {
    const cfg = await getConfig();
    if (!cfg.enabled || !cfg.browserKey) return false;
    return loadSdk(cfg.browserKey);
  }

  function toLatLng(point) {
    if (!point) return null;
    if (point.lat != null && point.lng != null) return { lat: Number(point.lat), lng: Number(point.lng) };
    return null;
  }

  // Mount a map. Returns the Map instance, or null when maps are unavailable.
  async function initMap(el, { origin, destination, region = "NG" } = {}) {
    if (!el) return null;
    const ok = await enabled();
    if (!ok) return null;

    const map = new google.maps.Map(el, {
      center: toLatLng(origin) || { lat: 6.5244, lng: 3.3792 }, // default: Lagos
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      region,
    });
    if (origin || destination) drawRoute(map, { origin, destination });
    return map;
  }

  let activeLine = null;
  let activeMarkers = [];

  function clearOverlays() {
    activeMarkers.forEach((m) => m.setMap(null));
    activeMarkers = [];
    if (activeLine) activeLine.setMap(null);
    activeLine = null;
  }

  // Draw markers + (optionally) a decoded polyline. Falls back to a straight
  // line between the two points when no polyline is provided.
  function drawRoute(map, { origin, destination, polyline } = {}) {
    if (!map) return;
    clearOverlays();
    const a = toLatLng(origin);
    const b = toLatLng(destination);

    if (a) activeMarkers.push(new google.maps.Marker({ position: a, map, label: "A" }));
    if (b) activeMarkers.push(new google.maps.Marker({ position: b, map, label: "B" }));

    const path = polyline ? google.maps.geometry.encoding.decodePath(polyline) : [a, b].filter(Boolean);
    if (path.length >= 2) {
      activeLine = new google.maps.Polyline({ path, map, strokeColor: "#17b26a", strokeWeight: 4, strokeOpacity: 0.85 });
    }

    if (path.length) {
      const bounds = new google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32 });
    }
  }

  // Attach Places autocomplete to a text input, using the BACKEND proxy so the
  // server key stays private. Calls onSelect(value) with the chosen address.
  async function autocomplete(input, onSelect) {
    if (!input) return;
    const ok = await enabled();
    if (!ok) return;

    const ac = new google.maps.places.Autocomplete(input, {
      types: ["geocode"],
      fields: ["formatted_address", "geometry"],
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const value = place?.formatted_address || input.value;
      input.value = value;
      if (typeof onSelect === "function") {
        onSelect(value, place?.geometry?.location ? { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() } : null);
      }
    });
  }

  window.AgbeMaps = { enabled, initMap, drawRoute, autocomplete };
})();
