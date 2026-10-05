// api.js — the ONLY place the frontend touches fetch.
//
// Responsibilities:
//   - send the httpOnly session cookie (same-origin defaults to including it)
//   - encode JSON, decode the { success, data } envelope
//   - turn backend failures into readable Errors carrying { code, details }
//   - on 401, bounce to login.html (unless already there)
//
// The frontend NEVER decides a balance or holds money logic — it only displays
// what the backend returns.

(function () {
  "use strict";

  function attempt(path, options = {}) {
    const opts = { credentials: "same-origin", headers: {}, ...options };

    if (opts.body && typeof opts.body !== "string" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }

    return fetch(`/api${path}`, opts).then(async (res) => {
      let json = null;
      try {
        json = await res.json();
      } catch (_) {
        json = null;
      }

      if (!res.ok) {
        if (res.status === 401 && !window.location.pathname.endsWith("login.html")) {
          const current = window.location.pathname + window.location.search;
          sessionStorage.setItem("agbe_after_login", current);
          window.location.replace(`login.html?next=${encodeURIComponent(current)}`);
        }
        const err = new Error(json?.message || `Request failed (${res.status})`);
        err.code = json?.code;
        err.details = json?.details;
        err.status = res.status;
        throw err;
      }

      return json?.data;
    });
  }

  // Retries a request a few times when the network connection itself dropped —
  // e.g. while the dev server restarts — but NEVER on an HTTP error or a 401.
  // Only used on idempotent calls (profile saves/fetches); money moves rely on
  // Idempotency-Key instead and must not auto-retry.
  async function request(path, options = {}) {
    const maxAttempts = (options.retry ?? 0) + 1;
    let attemptNumber = 0;
    for (;;) {
      try {
        return await attempt(path, options);
      } catch (err) {
        attemptNumber++;
        const isNetworkDrop = err instanceof TypeError && /failed to fetch|network error/i.test(err.message || "");
        if (!isNetworkDrop || attemptNumber >= maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, 900 * attemptNumber));
      }
    }
  }

  // A fresh unique key per money move → double-clicks can't double-charge.
  function idempotencyKey() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  // Download a file endpoint (e.g. the CSV statement) as a blob, honouring the
  // backend's Content-Disposition filename. Same session cookie as everything
  // else; only used for non-JSON responses.
  function download(path) {
    return fetch(`/api${path}`, { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
          const json = await res.json();
          if (json?.message) message = json.message;
        } catch (_) {
          /* not JSON */
        }
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      let filename = "agbedepay-download.csv";
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      if (match) filename = match[1];
      return { blob: await res.blob(), filename };
    });
  }

  // Exposed under BOTH names: `request` (full) and `api` (short alias used by
  // the page scripts, e.g. `const { api } = window.AgbeAPI`).
  window.AgbeAPI = { request, api: request, idempotencyKey, download };
})();