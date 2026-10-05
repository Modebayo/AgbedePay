// market service — REAL financial data for the dashboard, never AI-generated.
//
// Sources (keyless, public):
//   - FX (NGN vs USD/GBP/EUR/GHS/KES/ZAR): upstash-style open.jsdelivr currency
//     wrapper (Fawaz Ahmed) as PRIMARY, exchangerate-api.com as fallback.
//   - Crypto (BTC/ETH/USDT in NGN + 24h change): CoinGecko public simple/price.
//
// Design rules:
//   - Fetch only as often as the free APIs allow: one upstream call per TTL.
//   - Concurrent requests share a single in-flight fetch (coalescing).
//   - If an upstream is briefly down we serve the last good snapshot, marked
//     `stale: true`, instead of failing the whole dashboard widget.
//   - Everything here is market DISPLAY data. No balances, no wallet logic.

const FX_SOURCES = [
  {
    id: "exchangerate-api",
    url: "https://api.exchangerate-api.com/v4/latest/USD",
    unwrap: (j) => j.rates, // { NGN, GBP, ... }
  },
  {
    id: "currency-api",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    unwrap: (j) => j.usd, // { ngn, gbp, ... }
  },
];

const CRYPTO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=ngn&include_24hr_change=true";

// Currencies we quote: "how many naira buys 1 unit".
const FX_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "British Pound" },
  { code: "EUR", name: "Euro" },
  { code: "GHS", name: "Ghana Cedi" },
  { code: "KES", name: "Kenya Shilling" },
  { code: "ZAR", name: "South African Rand" },
];

// Crypto assets we quote, in NGN, with 24h change from CoinGecko.
const CRYPTO_ASSETS = [
  { id: "bitcoin", code: "BTC", name: "Bitcoin" },
  { id: "ethereum", code: "ETH", name: "Ethereum" },
  { id: "tether", code: "USDT", name: "Tether" },
];

const TTL_MS = 45_000; // how long we hold a snapshot before re-fetching

let snapshot = null; // { rates, crypto, fxSource, fetchedAt, stale }
let snapshotAt = 0;
let inflight = null;

async function httpJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Upstream ${url} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Grab USD-based rates from the first source that answers. Currency keys come
// back uppercase (exchangerate-api) or lowercase (currency-api); normalize so
// the rest of the code can always read `rates.NGN`.
async function fetchFxUsdRates() {
  for (const source of FX_SOURCES) {
    try {
      const json = await httpJson(source.url);
      const unwrapped = source.unwrap ? source.unwrap(json) : json;
      const base = Object.fromEntries(
        Object.entries(unwrapped).map(([k, v]) => [k.toUpperCase(), Number(v)])
      );
      if (Number.isFinite(base.NGN) && base.NGN > 0) {
        return { rates: base, source: source.id };
      }
    } catch (err) {
      console.warn("[market] FX source failed:", source.id, err.message);
    }
  }
  return null;
}

// Convert USD-based rates into "1 X = ? NGN" for the currencies we show.
function buildFxList(usdRates) {
  return FX_CURRENCIES.map(({ code, name }) => {
    const perUsd = Number(usdRates[code]);
    if (!Number.isFinite(perUsd) || perUsd <= 0) return null;
    return {
      code,
      name,
      rateNgn: Number((usdRates.NGN / perUsd).toFixed(2)),
    };
  }).filter(Boolean);
}

async function fetchCrypto() {
  try {
    const json = await httpJson(CRYPTO_URL);
    return CRYPTO_ASSETS.map(({ id, code, name }) => {
      const row = json[id];
      const price = row ? Number(row.ngn) : null;
      const change = row ? Number(row.ngn_24h_change) : null;
      if (!Number.isFinite(price) || price <= 0) return null;
      return { code, name, priceNgn: price, change24hPct: change };
    }).filter(Boolean);
  } catch (err) {
    console.warn("[market] crypto source failed:", err.message);
    return null;
  }
}

// Build a fresh snapshot from the live sources.
async function buildSnapshot() {
  const [fx, crypto] = await Promise.all([fetchFxUsdRates(), fetchCrypto()]);
  if (!fx && !crypto) return null; // every upstream is down

  return {
    fxSource: fx?.source ?? null,
    rates: fx ? buildFxList(fx.rates) : null,
    crypto,
    fetchedAt: Date.now(),
    stale: false,
  };
}

// Serve a cached snapshot, refreshing only after the TTL elapses. Concurrent
// callers share the same in-flight fetch so the free APIs are never hammered.
export async function getMarketSnapshot() {
  const now = Date.now();
  if (snapshot && now - snapshotAt < TTL_MS) return snapshot;

  if (!inflight) {
    inflight = buildSnapshot()
      .then((fresh) => {
        if (fresh) {
          snapshot = fresh;
          snapshotAt = Date.now();
        } else if (!snapshot) {
          snapshot = null;
          snapshotAt = now;
        }
        return snapshot;
      })
      .catch((err) => {
        console.warn("[market] snapshot build failed:", err.message);
        return snapshot; // serve whatever we had
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

// When an upstream dies mid-flight we keep serving the last good data, flagged
// so the UI can show "updated X ago" honestly instead of a fake "live" badge.
export async function getMarketWithFallback() {
  const market = await getMarketSnapshot();

  if (!market) {
    return { available: false, rates: null, crypto: null, updatedAt: null };
  }

  const cached = Object.assign({}, market);
  if (cached.fetchedAt && Date.now() - cached.fetchedAt > TTL_MS) {
    cached.stale = true;
  }

  return {
    available: true,
    source: cached.fxSource,
    rates: cached.rates,
    crypto: cached.crypto,
    updatedAt: new Date(cached.fetchedAt).toISOString(),
    stale: Boolean(cached.stale),
  };
}