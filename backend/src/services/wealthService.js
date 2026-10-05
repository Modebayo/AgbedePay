// wealth service — the business rules for the Wealth section.
//
// What lives here and not in the model:
//   - "who may do this" checks (ownership, the caller's own PIN)
//   - idempotency REPLAY (return the stored outcome instead of buying twice)
//   - VALUATION: turning holdings and orders into the numbers the UI shows
//   - mapping a business failure code into a clean HTTP error
// The model's executeBuy()/executeSell() own the actual ACID movement.
//
// Money stays in INTEGER kobo and units in INTEGER hundred-thousandths
// everywhere. We only FORMAT at the edge.

import * as wealthModel from "../models/wealthModel.js";
import * as walletModel from "../models/wallets.js";
import * as userModel from "../models/users.js";
import * as auditModel from "../models/audit.js";
import { notify, linkForType } from "./notificationsService.js";
import { priceFor, persistQuotes, primeQuotes } from "./wealthPricingService.js";
import { verifyPin } from "../utils/crypto.js";
import { generateReference } from "../utils/reference.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";
import { assertWalletActive } from "./walletService.js";

const { UNIT_SCALE, unitsToAmountMinor, amountToUnitsMinor } = wealthModel;

// The smallest order we will accept: ₦100. Below this the kobo rounding on
// fractional units starts to dominate the amount and a "trade" is noise.
const MIN_ORDER_MINOR = 10000;

// ---- Formatting helpers -----------------------------------------------------

// Hundred-thousandths -> a human unit string, without lying about precision.
// 100000 -> "1", 37420 -> "0.3742", 105000 -> "1.05"
export function formatUnits(unitsMinor) {
  const whole = Math.floor(unitsMinor / UNIT_SCALE);
  const frac = unitsMinor % UNIT_SCALE;
  if (frac === 0) return String(whole);
  return (unitsMinor / UNIT_SCALE).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function percentOf(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

// A Postgres DATE arrives as a JS Date pinned to LOCAL midnight, so
// `.toISOString()` — which converts to UTC — shifts it a day backwards for
// anyone east of Greenwich, and the maturity line would read "matures
// 2026-09-29" on a bond that matures on the 30th. Read the local calendar
// fields and format them by hand. Same reason the seed writes a plain
// "yyyy-mm-dd" string rather than a timestamp.
export function toIsoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Whole days from today to a maturity date, or null when there is no date.
// Compared in UTC on both sides: the maturity side goes through toIsoDate so it
// is the calendar day rather than an instant, and the "today" side is pinned to
// the same UTC frame, so a server in any timezone gets the same answer.
export function daysToMaturity(maturityDate, asOf = new Date()) {
  const iso = toIsoDate(maturityDate);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const start = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000);
}

// ---- DTO mappers ------------------------------------------------------------

function toApiInstrument(instrument, pricing) {
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    class: instrument.class,
    issuer: instrument.issuer ?? null,
    sector: instrument.sector ?? null,
    priceMinor: pricing.priceMinor,
    priceNgn: formatNaira(pricing.priceMinor),
    prevCloseMinor: pricing.prevCloseMinor,
    prevCloseNgn: pricing.prevCloseMinor === null ? null : formatNaira(pricing.prevCloseMinor),
    changePct: pricing.changePct,
    changeAbsNgn:
      pricing.changeAbsMinor === null || pricing.changeAbsMinor === undefined
        ? null
        : formatNaira(pricing.changeAbsMinor),
    yieldPct: instrument.yield_pct === null ? null : Number(instrument.yield_pct),
    riskLevel: instrument.risk_level,
    // Maturity, for the classes that have one. NULL everywhere else is a real
    // answer, not a gap: an equity or an open-ended fund never returns your
    // principal on a schedule, and the UI omits the line rather than printing a
    // blank one.
    maturityDate: toIsoDate(instrument.maturity_date),
    daysToMaturity: daysToMaturity(instrument.maturity_date),
    // The honest bit: is this number live, and if not, where did it come from?
    live: pricing.live,
    priceSource: pricing.source,
    delayedMinutes: pricing.delayedMinutes ?? null,
    pricedAt: pricing.pricedAt ?? instrument.priced_at ?? null,
    heldUnitsMinor:
      instrument.held_units_minor === null || instrument.held_units_minor === undefined
        ? 0
        : Number(instrument.held_units_minor),
    heldUnits: formatUnits(
      instrument.held_units_minor === null || instrument.held_units_minor === undefined
        ? 0
        : Number(instrument.held_units_minor)
    ),
  };
}

// A holding, valued. `costMinor` is net lifetime cost (buys minus sells) and
// `valueMinor` is today's position at the current price, so gain is real
// rather than "amount paid".
function toApiHolding(holding, pricing, costMinor) {
  const unitsMinor = Number(holding.units_minor);
  const valueMinor = unitsToAmountMinor(unitsMinor, pricing.priceMinor);
  const gainMinor = valueMinor - costMinor;

  return {
    id: holding.id,
    instrumentId: holding.instrument_id,
    symbol: holding.symbol,
    name: holding.instrument_name,
    class: holding.class,
    sector: holding.sector ?? null,
    issuer: holding.issuer ?? null,
    riskLevel: holding.risk_level,
    yieldPct: holding.yield_pct === null ? null : Number(holding.yield_pct),
    maturityDate: toIsoDate(holding.maturity_date),
    daysToMaturity: daysToMaturity(holding.maturity_date),
    unitsMinor,
    units: formatUnits(unitsMinor),
    avgCostMinor: Number(holding.avg_cost_minor),
    avgCostNgn: formatNaira(Number(holding.avg_cost_minor)),
    priceMinor: pricing.priceMinor,
    priceNgn: formatNaira(pricing.priceMinor),
    costMinor,
    costNgn: formatNaira(costMinor),
    valueMinor,
    valueNgn: formatNaira(valueMinor),
    gainMinor,
    gainNgn: formatNaira(gainMinor),
    gainPct: percentOf(gainMinor, costMinor),
    dayChangePct: pricing.changePct,
    live: pricing.live,
    priceSource: pricing.source,
    delayedMinutes: pricing.delayedMinutes ?? null,
    pricedAt: pricing.pricedAt ?? holding.priced_at ?? null,
    openedAt: holding.opened_at,
  };
}

function toApiOrder(o) {
  const amount = Number(o.amount_minor);
  return {
    id: o.id,
    instrumentId: o.instrument_id,
    holdingId: o.holding_id ?? null,
    symbol: o.symbol,
    name: o.instrument_name,
    class: o.class,
    sector: o.sector ?? null,
    type: o.type,
    unitsMinor: Number(o.units_minor),
    units: formatUnits(Number(o.units_minor)),
    amountMinor: amount,
    amountNgn: formatNaira(amount),
    unitPriceMinor: Number(o.unit_price_minor),
    unitPriceNgn: formatNaira(Number(o.unit_price_minor)),
    reference: o.reference,
    transactionId: o.transaction_id ?? null,
    status: o.status,
    failureReason: o.failure_reason ?? null,
    createdAt: o.created_at,
  };
}

// ---- Pricing ----------------------------------------------------------------

// Value a batch of instruments against ONE shared quote snapshot, so a page of
// twenty holdings costs exactly one upstream call rather than twenty.
async function priceMany(instruments) {
  await primeQuotes();
  return instruments.map((i) => priceFor(i));
}

// Prime the cache and price a single instrument. Used on the money path (buy,
// sell) so the fill price is never more than one TTL old.
async function priceOne(instrument) {
  await primeQuotes();
  return priceFor(instrument);
}

// ---- Instruments ------------------------------------------------------------

export async function listInstruments({ userId, className = null }) {
  const rows = await wealthModel.listInstruments({ userId, className });
  const pricings = await priceMany(rows);

  // Keep the write-back off the request's critical path: it is an optimisation
  // for the NEXT request, and a failure there must not fail this one.
  persistQuotes().catch(() => {});

  return {
    class: className ?? "ALL",
    instruments: rows.map((r, i) => toApiInstrument(r, pricings[i])),
  };
}

export async function getInstrument({ userId, instrumentId }) {
  const instrument = await wealthModel.findInstrumentById(instrumentId);
  if (!instrument || instrument.status !== "ACTIVE") {
    throw new ApiError(404, "Instrument not found", "INSTRUMENT_NOT_FOUND");
  }
  const held = await wealthModel.findActiveHoldingByInstrument(userId, instrumentId);
  const pricing = await priceOne(instrument);
  return {
    instrument: toApiInstrument({ ...instrument, held_units_minor: held?.units_minor ?? null }, pricing),
  };
}

// ---- Portfolio --------------------------------------------------------------

// One ACTIVE holding per instrument, valued, plus the totals and the split by
// class that the hub and the Portfolio page both need.
export async function getPortfolio({ userId }) {
  const rows = await wealthModel.findActiveHoldings(userId);
  if (!rows.length) {
    return { holdings: [], totals: emptyTotals(), allocation: [], live: false };
  }

  const costs = await Promise.all(rows.map((h) => wealthModel.costBasisForHolding(h.id)));
  const pricings = await priceMany(rows);
  const holdings = rows.map((h, i) => toApiHolding(h, pricings[i], costs[i]));

  const totals = holdings.reduce(
    (acc, h) => {
      acc.costMinor += h.costMinor;
      acc.valueMinor += h.valueMinor;
      return acc;
    },
    { costMinor: 0, valueMinor: 0, dayChangePct: null }
  );

  totals.gainMinor = totals.valueMinor - totals.costMinor;
  totals.gainPct = percentOf(totals.gainMinor, totals.costMinor);
  // Weighted day change: sum each position's value-weighted day move, which is
  // what actually happened to the portfolio, rather than averaging percentages
  // and pretending a ₦100 position counts as much as a ₦1,000,000 one.
  let dayMoveMinor = 0;
  for (const h of holdings) {
    if (h.dayChangePct !== null) dayMoveMinor += Math.floor((h.valueMinor * h.dayChangePct) / 100);
  }
  totals.dayChangeMinor = dayMoveMinor;
  totals.dayChangeNgn = formatNaira(dayMoveMinor);
  totals.dayChangePct = percentOf(dayMoveMinor, totals.valueMinor - dayMoveMinor);

  return {
    holdings,
    totals: toApiTotals(totals),
    allocation: buildAllocation(holdings),
    live: holdings.some((h) => h.live),
  };
}

function emptyTotals() {
  return toApiTotals({
    costMinor: 0,
    valueMinor: 0,
    gainMinor: 0,
    gainPct: null,
    dayChangeMinor: 0,
    dayChangePct: null,
  });
}

function toApiTotals(t) {
  return {
    costMinor: t.costMinor,
    costNgn: formatNaira(t.costMinor),
    valueMinor: t.valueMinor,
    valueNgn: formatNaira(t.valueMinor),
    gainMinor: t.gainMinor,
    gainNgn: formatNaira(t.gainMinor),
    gainPct: t.gainPct,
    dayChangeMinor: t.dayChangeMinor,
    dayChangeNgn: formatNaira(t.dayChangeMinor),
    dayChangePct: t.dayChangePct,
  };
}

// Allocation across the four classes, biggest first, with a percentage the
// chart can draw directly.
const CLASS_ORDER = ["STOCK", "FUND", "PENSION", "BOND"];
function buildAllocation(holdings) {
  const byClass = new Map(CLASS_ORDER.map((c) => [c, 0]));
  for (const h of holdings) {
    byClass.set(h.class, (byClass.get(h.class) ?? 0) + h.valueMinor);
  }
  const total = holdings.reduce((sum, h) => sum + h.valueMinor, 0);
  return CLASS_ORDER.filter((c) => byClass.get(c) > 0).map((className) => {
    const valueMinor = byClass.get(className);
    return {
      class: className,
      valueMinor,
      valueNgn: formatNaira(valueMinor),
      sharePct: percentOf(valueMinor, total),
    };
  });
}

// ---- Overview (the Wealth hub) ----------------------------------------------

// The hub is the portfolio plus a little context: how many positions, how many
// orders, and the most recent activity. One call so the page has everything.
export async function getOverview({ userId }) {
  const [portfolio, recent, orderCount] = await Promise.all([
    getPortfolio({ userId }),
    wealthModel.listOrders({ userId, page: 1, limit: 5, className: null, type: null }),
    wealthModel.countOrdersForUser(userId),
  ]);

  return {
    totals: portfolio.totals,
    allocation: portfolio.allocation,
    holdings: portfolio.holdings,
    holdingCount: portfolio.holdings.length,
    orderCount,
    live: portfolio.live,
    recentOrders: recent.rows.map(toApiOrder),
  };
}

// ---- Investment history -----------------------------------------------------

export async function listHistory({ userId, page, limit, className, type }) {
  const { rows, total } = await wealthModel.listOrders({ userId, page, limit, className, type });
  return { items: rows.map(toApiOrder), page, limit, total };
}

// ---- Shared guards ----------------------------------------------------------

// Re-authenticate with the caller's own PIN before any money moves. Argon2id
// verification via users.findByIdWithPin; we never read a pin_hash from a row
// that wasn't fetched for exactly this.
async function requireOwnPin(pin, userId) {
  const user = await userModel.findByIdWithPin(userId);
  const ok = user ? await verifyPin(user.pin_hash, pin) : false;
  if (!ok) {
    throw new ApiError(401, "Invalid PIN", "INVALID_PIN");
  }
}

// Model failure codes -> HTTP responses.
const FAILURE_STATUS = {
  WALLET_FROZEN: [403, "Wallet is frozen", "WALLET_FROZEN"],
  INSTRUMENT_UNAVAILABLE: [404, "This investment is not available right now", "INSTRUMENT_UNAVAILABLE"],
  INSUFFICIENT_FUNDS: [400, "Insufficient balance to make this investment"],
  NO_HOLDING: [404, "You do not hold this investment", "NO_HOLDING"],
  HOLDING_TOO_SMALL: [400, "You cannot sell more units than you hold", "HOLDING_TOO_SMALL"],
};

function apiErrorFor(code) {
  const [status, message, outCode = code] = FAILURE_STATUS[code] ?? [
    400,
    "Investment rejected",
    code,
  ];
  return new ApiError(status, message, outCode);
}

// ---- Buy --------------------------------------------------------------------

export async function buy({
  userId,
  instrumentId,
  amountMinor = null,
  unitsMinor = null,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  const instrument = await wealthModel.findInstrumentById(instrumentId);
  if (!instrument || instrument.status !== "ACTIVE") {
    throw new ApiError(404, "This investment is not available right now", "INSTRUMENT_UNAVAILABLE");
  }

  // Exactly one sizing mode. Both, or neither, is not a real instruction.
  const hasAmount = Number.isInteger(amountMinor);
  const hasUnits = Number.isInteger(unitsMinor);
  if (hasAmount === hasUnits) {
    throw new ApiError(
      400,
      "Send either an amount or a number of units — not both",
      ErrorCodes.VALIDATION
    );
  }

  // Price ONCE, then hold that number for the whole operation. Re-pricing
  // between the preview and the commit is how a customer gets a fill they did
  // not agree to, so the price we show is the price we execute at.
  const pricing = await priceOne(instrument);
  const unitPriceMinor = pricing.priceMinor;

  let units;
  let amount;
  if (hasAmount) {
    if (amountMinor < MIN_ORDER_MINOR) {
      throw new ApiError(400, `The smallest investment is ${formatNaira(MIN_ORDER_MINOR)}`, "ORDER_TOO_SMALL");
    }
    units = amountToUnitsMinor(amountMinor, unitPriceMinor);
    amount = unitsToAmountMinor(units, unitPriceMinor);
    if (amount < MIN_ORDER_MINOR) {
      throw new ApiError(400, `That buys less than ${formatNaira(MIN_ORDER_MINOR)} — try a larger amount`, "ORDER_TOO_SMALL");
    }
  } else {
    units = unitsMinor;
    amount = unitsToAmountMinor(units, unitPriceMinor);
    if (amount < MIN_ORDER_MINOR) {
      throw new ApiError(400, `That is worth less than ${formatNaira(MIN_ORDER_MINOR)}`, "ORDER_TOO_SMALL");
    }
  }

  // Idempotency: has this (wallet, key) already produced a result?
  const existing = await wealthModel.findOrderByWalletAndKey(wallet.id, idempotencyKey, "WEALTH_BUY");
  if (existing) return replay({ userId, existing, idempotencyKey, ipAddress, userAgent, action: "BUY" });

  const result = await wealthModel.executeBuy({
    userId,
    instrumentId,
    walletId: wallet.id,
    unitsMinor: units,
    amountMinor: amount,
    unitPriceMinor,
    reference: generateReference("BUY"),
    idempotencyKey,
  });

  // Lost a race: another request with this key committed first -> replay theirs.
  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await wealthModel.findOrderByWalletAndKey(wallet.id, idempotencyKey, "WEALTH_BUY");
    if (winner) return replay({ userId, existing: winner, idempotencyKey, ipAddress, userAgent, action: "BUY" });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "WEALTH_BUY_FAILED",
      entityType: "WEALTH_INSTRUMENT",
      entityId: instrumentId,
      metadata: { code: result.code, amountMinor: amount, unitsMinor: units },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "WEALTH_BUY_SUCCESS",
    entityType: "WEALTH_INSTRUMENT",
    entityId: instrumentId,
    metadata: { reference: result.order.reference, amountMinor: amount, unitsMinor: units },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "WEALTH",
    link: linkForType("WEALTH"),
    title: `${formatNaira(amount)} invested in ${instrument.symbol}`,
    body: `${formatUnits(units)} unit${units === UNIT_SCALE ? "" : "s"} of ${instrument.name} at ${formatNaira(unitPriceMinor)} each.`,
  });

  return {
    order: toApiOrder({
      ...result.order,
      symbol: instrument.symbol,
      instrument_name: instrument.name,
      class: instrument.class,
      sector: instrument.sector,
    }),
    unitsMinor: units,
    units: formatUnits(units),
    amountMinor: amount,
    amountNgn: formatNaira(amount),
    unitPriceMinor,
    unitPriceNgn: formatNaira(unitPriceMinor),
    priceLive: pricing.live,
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: false,
  };
}

// ---- Sell -------------------------------------------------------------------

export async function sell({
  userId,
  holdingId,
  unitsMinor,
  pin,
  idempotencyKey,
  ipAddress,
  userAgent,
}) {
  const wallet = await assertWalletActive(userId);
  await requireOwnPin(pin, userId);

  // Ownership IS the security here: a holding is only visible to the person who
  // owns it. No endpoint can be coaxed into selling someone else's position.
  const holding = await wealthModel.findHoldingById(holdingId);
  if (!holding || holding.user_id !== userId || holding.status !== "ACTIVE") {
    throw new ApiError(404, "Investment not found", "HOLDING_NOT_FOUND");
  }

  const instrument = await wealthModel.findInstrumentById(holding.instrument_id);
  const pricing = await priceOne(instrument);

  const units = unitsMinor;
  if (Number(holding.units_minor) < units) {
    throw new ApiError(400, "You cannot sell more units than you hold", "HOLDING_TOO_SMALL");
  }

  const amount = unitsToAmountMinor(units, pricing.priceMinor);
  if (amount < 1) {
    throw new ApiError(400, "That is worth less than ₦0.01 — sell more units", "ORDER_TOO_SMALL");
  }

  const existing = await wealthModel.findOrderByWalletAndKey(wallet.id, idempotencyKey, "WEALTH_SELL");
  if (existing) return replay({ userId, existing, idempotencyKey, ipAddress, userAgent, action: "SELL" });

  const result = await wealthModel.executeSell({
    userId,
    instrumentId: holding.instrument_id,
    walletId: wallet.id,
    unitsMinor: units,
    amountMinor: amount,
    unitPriceMinor: pricing.priceMinor,
    reference: generateReference("SEL"),
    idempotencyKey,
  });

  if (!result.ok && result.code === "IDEMPOTENCY_CONFLICT") {
    const winner = await wealthModel.findOrderByWalletAndKey(wallet.id, idempotencyKey, "WEALTH_SELL");
    if (winner) return replay({ userId, existing: winner, idempotencyKey, ipAddress, userAgent, action: "SELL" });
  }

  if (!result.ok) {
    await auditModel.record({
      userId,
      action: "WEALTH_SELL_FAILED",
      entityType: "WEALTH_HOLDING",
      entityId: holdingId,
      metadata: { code: result.code, amountMinor: amount, unitsMinor: units },
      ipAddress,
      userAgent,
    });
    throw apiErrorFor(result.code);
  }

  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: "WEALTH_SELL_SUCCESS",
    entityType: "WEALTH_HOLDING",
    entityId: holdingId,
    metadata: { reference: result.order.reference, amountMinor: amount, unitsMinor: units },
    ipAddress,
    userAgent,
  });

  await notify({
    userId,
    type: "WEALTH",
    link: linkForType("WEALTH"),
    title: `${formatNaira(amount)} received from selling ${instrument.symbol}`,
    body: `Back in your wallet: ${formatNaira(freshWallet.balance_minor)}.`,
  });

  return {
    order: toApiOrder({
      ...result.order,
      symbol: instrument.symbol,
      instrument_name: instrument.name,
      class: instrument.class,
      sector: instrument.sector,
    }),
    unitsMinor: units,
    units: formatUnits(units),
    amountMinor: amount,
    amountNgn: formatNaira(amount),
    unitPriceMinor: pricing.priceMinor,
    unitPriceNgn: formatNaira(pricing.priceMinor),
    remainingUnitsMinor: result.remainingUnitsMinor,
    remainingUnits: formatUnits(result.remainingUnitsMinor),
    closed: result.remainingUnitsMinor === 0,
    priceLive: pricing.live,
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: false,
  };
}

// Share the STORED outcome of an already-processed (wallet, key) order. The
// money does NOT move twice; the caller gets the original result back.
async function replay({ userId, existing, idempotencyKey, ipAddress, userAgent, action }) {
  const freshWallet = await walletModel.findByUserId(userId);

  await auditModel.record({
    userId,
    action: `WEALTH_${action}_REPLAYED`,
    entityType: "WEALTH_ORDER",
    entityId: existing.id,
    metadata: { idempotencyKey, amountMinor: Number(existing.amount_minor) }, // never the whole key
    ipAddress,
    userAgent,
  });

  return {
    order: toApiOrder({
      ...existing,
      symbol: existing.symbol ?? "—",
      instrument_name: existing.instrument_name ?? null,
      class: existing.class ?? null,
    }),
    amountMinor: Number(existing.amount_minor),
    amountNgn: formatNaira(Number(existing.amount_minor)),
    unitsMinor: Number(existing.units_minor),
    units: formatUnits(Number(existing.units_minor)),
    balanceMinor: Number(freshWallet.balance_minor),
    balanceNgn: formatNaira(freshWallet.balance_minor),
    replayed: true,
    notice: "This investment was already processed.",
  };
}
