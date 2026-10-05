// wealth pricing service — REAL prices for the Wealth section, never invented.
//
// Source: the Nigerian Exchange (NGX) as republished by TradingView's PUBLIC
// screener at https://scanner.tradingview.com/nigeria/scan. It is keyless, so
// like services/marketService.js we can quote live data without an account.
//
// Why this endpoint and not the obvious ones:
//   - Yahoo Finance carries no .NG coverage (MTNN.NG, DANGCAN.NG, UBA.NG etc.
//     all return "No data found").
//   - NGX's own price-watch page has no machine-readable endpoint.
//   - The commercial NGX APIs (oanor, ngxpulse, koboterminal) all require a
//     key and all wrap this very screener.
// The exchange prefix is "NSENG", NOT "NGX" — asking for NGX:* returns zero
// rows, which is a very quiet way to get no data at all.
//
// HONESTY RULES (the same discipline as marketService.js):
//   - NGX equities are published on a 30-minute delay; the upstream reports it
//     as "delayed_streaming_1800" and we pass that through as `delayedMinutes`
//     so the UI can badge it rather than imply real-time.
//   - FUND, PENSION and BOND have NO keyless live feed anywhere. Their prices
//     come from wealth_instruments (seeded indicative rates) and are returned
//     with live: false and source: "INDICATIVE". We do not dress those up as
//     live quotes, because that would be making up financial data.
//   - When the feed dies mid-flight we serve the last good snapshot marked
//     `stale: true` rather than blanking the page.
//
// This service only READS prices and caches them. It never touches a balance —
// see wealthService.js for anything that moves money.

import * as wealthModel from "../models/wealthModel.js";

const SCANNER_URL = "https://scanner.tradingview.com/nigeria/scan";
const EXCHANGE_PREFIX = "NSENG";

const TTL_MS = 60_000; // one upstream call per minute at most

// Columns we ask for. Keep in step with readQuoteRow() below.
const COLUMNS = [
  "name",
  "close",
  "change",
  "change_abs",
  "volume",
  "market_cap_basic",
  "sector",
  "description",
  "currency",
  "update_mode",
];

let snapshot = null; // { quotes: Map, fetchedAt, stale }
let snapshotAt = 0;
let inflight = null;

// One POST for a batch of tickers. Returns a plain object keyed by BARE symbol
// ("MTNN", not "NSENG:MTNN") so callers can index it directly.
async function fetchQuotes(symbols) {
  if (!symbols.length) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(SCANNER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: {
          tickers: symbols.map((s) => `${EXCHANGE_PREFIX}:${s}`),
          query: { types: [] },
        },
        columns: COLUMNS,
      }),
    });
    if (!res.ok) throw new Error(`scanner -> HTTP ${res.status}`);

    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return Object.fromEntries(rows.map((row) => [String(row.s).split(":")[1], readQuoteRow(row)]));
  } finally {
    clearTimeout(timer);
  }
}

// Turn one screener row into our quote shape. Returns null for a row we can't
// price (no usable close) so a bad row never becomes a NaN holding value.
function readQuoteRow(row) {
  const d = Array.isArray(row.d) ? row.d : [];
  const [name, close, change, changeAbs, volume, marketCap, sector, description, currency, updateMode] = d;

  const price = Number(close);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    symbol: String(row.s).split(":")[1],
    name: description || name || null,
    sector: sector || null,
    // Naira per share -> kobo. Round, because the feed is 2dp at best.
    priceMinor: Math.round(price * 100),
    changePct: Number.isFinite(Number(change)) ? Number(Number(change).toFixed(2)) : null,
    changeAbsMinor: Number.isFinite(Number(changeAbs)) ? Math.round(Number(changeAbs) * 100) : null,
    volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
    marketCap: Number.isFinite(Number(marketCap)) ? Number(marketCap) : null,
    currency: currency || "NGN",
    // The feed self-describes its delay; surface it rather than guessing.
    delayedMinutes: String(updateMode || "").includes("1800") ? 30 : null,
  };
}

// Merge a fresh batch over the previous snapshot so a ticker that is missing
// this minute (suspended, not yet listed) keeps its last known price.
function mergeInto(previous, fresh) {
  const quotes = new Map(previous?.quotes ?? []);
  for (const [symbol, quote] of Object.entries(fresh)) {
    if (quote) quotes.set(symbol, quote);
  }
  return { quotes, fetchedAt: Date.now() };
}

// Refresh the cached snapshot for a set of stock symbols.
async function buildSnapshot(symbols) {
  try {
    const fresh = await fetchQuotes(symbols);
    if (!Object.keys(fresh).length) {
      // Every ticker came back unusable. Keep what we had rather than wiping it.
      return snapshot;
    }
    return mergeInto(snapshot, fresh);
  } catch (err) {
    console.warn("[wealth-pricing] quote fetch failed:", err.message);
    return snapshot; // serve whatever we had
  }
}

// Cached quotes for the given stock symbols, refreshing at most once per TTL.
// Concurrent callers share a single in-flight request so the free feed is
// never hammered. An EMPTY symbols list still returns the cached snapshot.
export async function getStockQuotes(symbols = []) {
  const now = Date.now();
  if (snapshot && now - snapshotAt < TTL_MS) return snapshot;

  if (!inflight) {
    snapshotAt = now;
    inflight = buildSnapshot(symbols)
      .then((fresh) => {
        if (fresh) {
          snapshot = fresh;
          snapshotAt = Date.now();
        }
        return snapshot;
      })
      .catch((err) => {
        console.warn("[wealth-pricing] snapshot build failed:", err.message);
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

// Read a symbol out of the cache WITHOUT triggering a fetch. Pure: this is
// what lets a page price twenty holdings from one upstream call.
function readCachedQuote(symbol) {
  return snapshot?.quotes?.get(symbol) ?? null;
}

// Make sure the cache covers every tradeable stock, then hand back the shared
// snapshot. This is the ONE entry point the request path should use: it warms
// the full universe in a single call, and every priceFor() below then reads
// from that same snapshot.
//
// Without this, priceFor(instrument) fetching per-instrument meant the first
// holding got a live quote and every other one silently fell through to
// "CACHED" — a page of live-looking numbers where only the first was live.
export async function primeQuotes() {
  const stocks = await wealthModel.findTradableInstrumentsByClass("STOCK");
  return getStockQuotes(stocks.map((i) => i.symbol));
}

// Write live prices back into wealth_instruments. This is what lets a holding
// still be valued when the feed is down: the last good price is already in the
// table, flagged is_live with a priced_at stamp.
//
// Best-effort by design — a price write failing must never fail the read the
// customer is waiting on.
export async function persistQuotes() {
  const cached = await primeQuotes();
  if (!cached) return { updated: 0 };

  const stocks = await wealthModel.findTradableInstrumentsByClass("STOCK");
  if (!stocks.length) return { updated: 0 };

  const bySymbol = new Map(stocks.map((i) => [i.symbol, i]));
  const updates = [];
  for (const [symbol, quote] of cached.quotes) {
    const instrument = bySymbol.get(symbol);
    if (!instrument || !quote) continue;
    // Only write when something actually moved, so priced_at means "this
    // price is no older than the stamp", not "we looked recently".
    if (Number(instrument.unit_price_minor) === quote.priceMinor) continue;
    updates.push(quote);
  }
  if (!updates.length) return { updated: 0 };

  try {
    await wealthModel.applyLivePrices(updates);
    return { updated: updates.length };
  } catch (err) {
    console.warn("[wealth-pricing] price persist failed:", err.message);
    return { updated: 0 };
  }
}

// The pricing a single instrument should be shown at.
//
// STOCK -> the live quote when the primed cache has one, otherwise the stored
//          price.
// Other classes -> always the stored indicative price, never faked as live.
//
// This is a PURE READ of the cache. Callers prime it with primeQuotes() (or
// getStockQuotes()) first; this function never fetches, so a page of holdings
// costs exactly one upstream call in total.
export function priceFor(instrument) {
  if (instrument.class !== "STOCK") {
    return {
      priceMinor: Number(instrument.unit_price_minor),
      prevCloseMinor:
        instrument.prev_close_minor === null
          ? null
          : Number(instrument.prev_close_minor),
      changePct: percentChange(instrument.unit_price_minor, instrument.prev_close_minor),
      live: false,
      source: "INDICATIVE",
      delayedMinutes: null,
      pricedAt: instrument.priced_at,
    };
  }

  const quote = readCachedQuote(instrument.symbol);

  if (quote) {
    return {
      priceMinor: quote.priceMinor,
      prevCloseMinor:
        quote.changePct === null
          ? null
          : quote.priceMinor - quote.changeAbsMinor,
      changePct: quote.changePct,
      live: true,
      source: "NGX",
      delayedMinutes: quote.delayedMinutes,
      pricedAt: snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toISOString() : null,
    };
  }

  // Feed down or ticker unknown: fall back to the stored price and SAY it is
  // stored, rather than showing a live badge over a stale number.
  return {
    priceMinor: Number(instrument.unit_price_minor),
    prevCloseMinor:
      instrument.prev_close_minor === null
        ? null
        : Number(instrument.prev_close_minor),
    changePct: percentChange(instrument.unit_price_minor, instrument.prev_close_minor),
    live: false,
    source: "CACHED",
    delayedMinutes: null,
    pricedAt: instrument.priced_at,
  };
}

function percentChange(currentMinor, prevMinor) {
  if (currentMinor === null || currentMinor === undefined) return null;
  if (prevMinor === null || prevMinor === undefined) return null;
  const prev = Number(prevMinor);
  if (!Number.isFinite(prev) || prev <= 0) return null;
  return Number((((Number(currentMinor) - prev) / prev) * 100).toFixed(2));
}

// Drop the cache. Used by tests, and by nothing in the request path.
export function resetQuoteCache() {
  snapshot = null;
  snapshotAt = 0;
  inflight = null;
}
