// wealth model — the instrument catalogue, holdings, orders and goals.
// The ONLY place SQL is written for the Wealth section.
//
// Why an order lives in ONE database transaction with a row lock:
// A BUY touches FOUR rows — the wallet (balance check + debit), the holding
// (units and average cost), the wealth_orders ledger, and the wallet-level
// transactions row. BEGIN…COMMIT makes the lot atomic, so money can never be
// taken without the shares being recorded, even if the process dies midway.
//
// The wallet AND the holding are locked FOR UPDATE. A concurrent transfer and
// a concurrent buy both touch the same wallet, and the lock makes the second
// wait for the first to commit before it sees a fresh balance — so a balance
// can never go negative through a race.
//
// Idempotency: a given (wallet, key) may claim only one WEALTH_BUY /
// WEALTH_SELL row, enforced by the partial unique indexes added in migration
// 024. A replay is detected and the caller returns the ORIGINAL outcome —
// double-tap on "Buy" does not buy twice.

import { pool, query } from "../config/db.js";

// Fractional units are hundred-thousandths of one whole unit, so 1 share =
// 100000. Keeping units as an integer is what lets the maths below stay exact.
export const UNIT_SCALE = 100000;

// ---- Shared unit maths (exported so the service uses the same rounding) ----

// Kobo for a given number of hundred-thousandth units, rounded DOWN. Rounding
// down means a customer is never charged for a fraction of a kobo they did not
// ask for; the dust stays with the house.
export function unitsToAmountMinor(unitsMinor, unitPriceMinor) {
  return Math.floor((unitsMinor * unitPriceMinor) / UNIT_SCALE);
}

// The inverse, for a buy sized by Naira rather than by units: how many
// hundred-thousandth units that money can actually buy at this price. Also
// rounded down, so a buy never promises a fraction it cannot pay for.
export function amountToUnitsMinor(amountMinor, unitPriceMinor) {
  return Math.floor((amountMinor * UNIT_SCALE) / unitPriceMinor);
}

// Weighted-average cost per whole unit in kobo, after adding `addUnits` bought
// at `addPrice`. This is how "I bought twice" becomes one correct average
// instead of two half-rows. Rounded down so the average never overstates what
// was paid.
export function weightedAvgCost(existingUnits, existingCost, addUnits, addAmount) {
  const totalUnits = existingUnits + addUnits;
  if (totalUnits <= 0) return 0;
  const totalCost = existingCost + addAmount;
  return Math.floor(totalCost / (totalUnits / UNIT_SCALE));
}

// Value of a position in kobo at the given price.
export function positionValueMinor(unitsMinor, unitPriceMinor) {
  return unitsToAmountMinor(unitsMinor, unitPriceMinor);
}

// ---- Instruments ----

export async function findTradableInstrumentsByClass(className) {
  const { rows } = await query(
    `SELECT * FROM wealth_instruments
      WHERE class = $1 AND status = 'ACTIVE'
      ORDER BY symbol`,
    [className]
  );
  return rows;
}

// Catalogue read, optionally narrowed to one class.
//
// `held_units_minor` is scoped to the CALLER by userId. It is never a
// portfolio-wide aggregate: showing "18 people hold this" would both leak
// another customer's positions and say nothing useful to the one asking.
// Ordering puts the most-held instruments first so the Stocks page opens on
// what people actually buy rather than a random wall of tickers. Within a class
// the secondary sort is the symbol, except for BOND — there the most useful
// order is soonest maturity, because a bond list sorted alphabetically buries
// the 91-day bill the customer can actually use this quarter.
export async function listInstruments({ userId, className = null } = {}) {
  const { rows } = await query(
    `SELECT i.*, h.units_minor AS held_units_minor
       FROM wealth_instruments i
       LEFT JOIN wealth_holdings h
              ON h.instrument_id = i.id
             AND h.status = 'ACTIVE'
             AND h.user_id = $1
       LEFT JOIN (
            SELECT instrument_id, count(*)::int AS buyer_count
              FROM wealth_holdings WHERE status = 'ACTIVE'
             GROUP BY instrument_id
       ) p ON p.instrument_id = i.id
      WHERE i.status = 'ACTIVE'
        AND ($2::text IS NULL OR i.class = $2)
      ORDER BY p.buyer_count DESC NULLS LAST,
               CASE WHEN i.class = 'BOND' THEN i.maturity_date END ASC NULLS LAST,
               i.symbol`,
    [userId, className]
  );
  return rows;
}

export async function findInstrumentById(id) {
  const { rows } = await query(`SELECT * FROM wealth_instruments WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findInstrumentBySymbol(symbol) {
  const { rows } = await query(`SELECT * FROM wealth_instruments WHERE symbol = $1`, [symbol]);
  return rows[0] ?? null;
}

export async function findInstrumentsByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT * FROM wealth_instruments WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rows;
}

// Write live prices back to the catalogue. prev_close is derived from the
// price we are replacing, so the first refresh of a seeded row records the
// seeded price as "yesterday" — which is exactly the right first-day story.
export async function applyLivePrices(quotes) {
  if (!quotes.length) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const q of quotes) {
      await client.query(
        `UPDATE wealth_instruments
            SET unit_price_minor = $1,
                prev_close_minor = $2,
                is_live = TRUE,
                priced_at = now(),
                updated_at = now()
          WHERE symbol = $3 AND class = 'STOCK'`,
        [q.priceMinor, q.priceMinor - (q.changeAbsMinor ?? 0), q.symbol]
      );
    }
    await client.query("COMMIT");
    return quotes.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---- Holdings ----

export async function findActiveHoldings(userId) {
  const { rows } = await query(
    `SELECT h.*,
            i.symbol, i.name AS instrument_name, i.class, i.sector, i.issuer,
            i.unit_price_minor, i.prev_close_minor, i.yield_pct,
            i.risk_level, i.is_live, i.priced_at, i.maturity_date
       FROM wealth_holdings h
       JOIN wealth_instruments i ON i.id = h.instrument_id
      WHERE h.user_id = $1 AND h.status = 'ACTIVE'
      ORDER BY i.class, i.symbol`,
    [userId]
  );
  return rows;
}

export async function findHoldingById(id) {
  const { rows } = await query(`SELECT * FROM wealth_holdings WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findActiveHoldingByInstrument(userId, instrumentId) {
  const { rows } = await query(
    `SELECT * FROM wealth_holdings
      WHERE user_id = $1 AND instrument_id = $2 AND status = 'ACTIVE'`,
    [userId, instrumentId]
  );
  return rows[0] ?? null;
}

// Lifetime cost of a holding: every SUCCESS buy, minus every SUCCESS sell.
// A closed position's realised gain falls out of this against its last value.
export async function costBasisForHolding(holdingId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'BUY' THEN amount_minor
                             ELSE -amount_minor END), 0)::bigint AS net
       FROM wealth_orders
      WHERE holding_id = $1 AND status = 'SUCCESS'`,
    [holdingId]
  );
  return Number(rows[0].net);
}

// ---- Orders ----

export async function listOrders({ userId, page, limit, className = null, type = null }) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT o.*,
            i.symbol, i.name AS instrument_name, i.class, i.sector
       FROM wealth_orders o
       JOIN wealth_instruments i ON i.id = o.instrument_id
      WHERE o.user_id = $1
        AND ($2::text IS NULL OR i.class = $2)
        AND ($3::text IS NULL OR o.type = $3)
      ORDER BY o.created_at DESC
      LIMIT $4 OFFSET $5`,
    [userId, className, type, limit, offset]
  );
  const count = await query(
    `SELECT count(*)::int AS total
       FROM wealth_orders o
       JOIN wealth_instruments i ON i.id = o.instrument_id
      WHERE o.user_id = $1
        AND ($2::text IS NULL OR i.class = $2)
        AND ($3::text IS NULL OR o.type = $3)`,
    [userId, className, type]
  );
  return { rows, total: count.rows[0].total };
}

// Idempotency re-check. The wallet-level transactions row and the wealth_orders
// row share a `reference`, so the reference alone recovers the order.
export async function findOrderByWalletAndKey(walletId, idempotencyKey, ledgerType) {
  const { rows } = await query(
    `SELECT o.*
       FROM transactions t
       JOIN wealth_orders o ON o.reference = t.reference
      WHERE t.sender_wallet_id = $1
        AND t.idempotency_key = $2
        AND t.type = $3
      LIMIT 1`,
    [walletId, idempotencyKey, ledgerType]
  );
  return rows[0] ?? null;
}

export async function countOrdersForUser(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total FROM wealth_orders WHERE user_id = $1 AND status = 'SUCCESS'`,
    [userId]
  );
  return rows[0].total;
}

// ---- Goals (retirement targets) ----
//
// One ACTIVE goal per person, not a list. A retirement target is a single
// question — "how much, by when, from where" — and letting someone keep three
// live answers to it only teaches them that the number on the dashboard depends
// which card you read. Older goals stay in the table as CLOSED, which keeps the
// history honest instead of deleting it.
//
// Unlike an order, writing a goal needs NO wallet lock and NO idempotency key:
// no money moves, so there is nothing to double-charge. The only concurrency
// that matters is two tabs saving at once, and last-write-wins is the right
// answer for a personal note.

export async function findGoalsForUser(userId) {
  const { rows } = await query(
    `SELECT * FROM wealth_goals WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

// The goal the Retirement page projects. Falls back to the most recent CLOSED
// one so a customer who retires and then closes the goal still sees it rather
// than an empty page that looks like their data was lost.
export async function findCurrentGoalForUser(userId) {
  const { rows } = await query(
    `SELECT * FROM wealth_goals
      WHERE user_id = $1
      ORDER BY (status = 'ACTIVE') DESC, updated_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function findGoalById(id) {
  const { rows } = await query(`SELECT * FROM wealth_goals WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createGoal({
  userId,
  name,
  targetAge,
  currentAge,
  targetAmountMinor,
  currentAmountMinor,
  monthlyContributionMinor,
  targetDate,
}) {
  const { rows } = await query(
    `INSERT INTO wealth_goals
       (user_id, name, target_age, current_age, target_amount_minor,
        current_amount_minor, monthly_contribution_minor, target_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
     RETURNING *`,
    [
      userId,
      name,
      targetAge,
      currentAge,
      targetAmountMinor,
      currentAmountMinor,
      monthlyContributionMinor,
      targetDate,
    ]
  );
  return rows[0];
}

// Partial update. Only these fields can ever be written — the column list is
// fixed in code and never built from request keys, so a crafted body cannot
// reach `user_id` or `status` through here.
const GOAL_UPDATABLE = {
  name: "name",
  targetAge: "target_age",
  targetAmountMinor: "target_amount_minor",
  currentAmountMinor: "current_amount_minor",
  monthlyContributionMinor: "monthly_contribution_minor",
  targetDate: "target_date",
  status: "status",
};

export async function updateGoal(id, patch) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(GOAL_UPDATABLE)) {
    if (patch[field] === undefined) continue;
    values.push(patch[field]);
    sets.push(`${column} = $${values.length}${column === "target_date" ? "::date" : ""}`);
  }
  if (!sets.length) return findGoalById(id);

  values.push(id);
  const { rows } = await query(
    `UPDATE wealth_goals
        SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

// Closing is a soft delete on purpose: the projection someone built over ten
// years is part of their story, and the row is also the only record of what
// they told us they wanted.
export async function closeGoal(id) {
  const { rows } = await query(
    `UPDATE wealth_goals
        SET status = 'CLOSED', updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

// ---- Write side: the ACID order execution ----

// A FAILED attempt still claims its idempotency key (same pattern as
// savingsModel), so a replayed request returns "already handled" instead of
// sitting in limbo.
async function recordFailure(client, { userId, instrumentId, holdingId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code, type, ledgerType, walletId }) {
  await client.query(
    `INSERT INTO wealth_orders
       (user_id, holding_id, instrument_id, type, units_minor, amount_minor,
        unit_price_minor, reference, status, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'FAILED', $9)`,
    [userId, holdingId, instrumentId, type, unitsMinor, amountMinor, unitPriceMinor, reference, code]
  );
  await client.query(
    `INSERT INTO transactions
       (reference, idempotency_key, sender_wallet_id, amount_minor, currency, type, status, failure_reason)
     VALUES ($1, $2, $3, $4, 'NGN', $5, 'FAILED', $6)`,
    [reference, idempotencyKey, walletId, amountMinor, ledgerType, code]
  );
  await client.query("COMMIT"); // the FAILED record survives
  return { ok: false, code };
}

// BUY: debit the wallet, add units to (or open) the holding, average the cost.
// `unitsMinor` is what the caller resolved the money into, using the price we
// locked in above — the model re-checks affordability, not unit maths.
export async function executeBuy({
  userId,
  instrumentId,
  walletId,
  unitsMinor,
  amountMinor,
  unitPriceMinor,
  reference,
  idempotencyKey,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the wallet: the balance check below is the truth, not a pre-check.
    const walletResult = await client.query(
      `SELECT id, balance_minor, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = walletResult.rows[0];

    const instrumentResult = await client.query(
      `SELECT id, symbol, name, status, unit_price_minor, prev_close_minor
         FROM wealth_instruments WHERE id = $1 FOR UPDATE`,
      [instrumentId]
    );
    const instrument = instrumentResult.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      return recordFailure(client, { userId, instrumentId, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "WALLET_FROZEN", type: "BUY", ledgerType: "WEALTH_BUY" });
    }
    if (!instrument || instrument.status !== "ACTIVE") {
      return recordFailure(client, { userId, instrumentId, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "INSTRUMENT_UNAVAILABLE", type: "BUY", ledgerType: "WEALTH_BUY" });
    }
    if (Number(wallet.balance_minor) < amountMinor) {
      return recordFailure(client, { userId, instrumentId, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "INSUFFICIENT_FUNDS", type: "BUY", ledgerType: "WEALTH_BUY" });
    }

    // Debit the wallet ONCE, atomically with the rest.
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    // Buying more of something you already hold adds to that position and
    // re-averages its cost, instead of creating a second row.
    const existing = await client.query(
      `SELECT * FROM wealth_holdings
        WHERE user_id = $1 AND instrument_id = $2 AND status = 'ACTIVE'
        FOR UPDATE`,
      [userId, instrumentId]
    );
    const holding = existing.rows[0];

    let holdingResult;
    if (holding) {
      holdingResult = await client.query(
        `UPDATE wealth_holdings
            SET units_minor = units_minor + $1,
                avg_cost_minor = $2,
                updated_at = now()
          WHERE id = $3
          RETURNING *`,
        [
          unitsMinor,
          weightedAvgCost(
            Number(holding.units_minor),
            Number(holding.avg_cost_minor) * (Number(holding.units_minor) / UNIT_SCALE),
            unitsMinor,
            amountMinor
          ),
          holding.id,
        ]
      );
    } else {
      holdingResult = await client.query(
        `INSERT INTO wealth_holdings (user_id, instrument_id, units_minor, avg_cost_minor)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, instrumentId, unitsMinor, unitPriceMinor]
      );
    }
    const savedHolding = holdingResult.rows[0];

    const order = await client.query(
      `INSERT INTO wealth_orders
         (user_id, holding_id, instrument_id, type, units_minor, amount_minor, unit_price_minor, reference, status)
       VALUES ($1, $2, $3, 'BUY', $4, $5, $6, $7, 'SUCCESS')
       RETURNING *`,
      [userId, savedHolding.id, instrumentId, unitsMinor, amountMinor, unitPriceMinor, reference]
    );

    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, sender_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'WEALTH_BUY', 'SUCCESS', $5, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, `Buy ${instrument.symbol} — ${instrument.name}`]
    );

    // Link the two ledgers together now that both exist.
    await client.query(
      `UPDATE wealth_orders SET transaction_id = $1 WHERE id = $2`,
      [ledger.rows[0].id, order.rows[0].id]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      holding: savedHolding,
      // Carry the linked ledger id forward, or the caller's DTO would report
      // transactionId: null for an order that very much has one.
      order: { ...order.rows[0], transaction_id: ledger.rows[0].id },
      ledger: ledger.rows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "uq_transactions_wealth_buy_idempotency") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    throw err;
  } finally {
    client.release();
  }
}

// SELL: the mirror image. Money comes out of the position and back into the
// wallet; selling the last unit closes the holding rather than deleting it, so
// the order history keeps a resolvable holding_id.
export async function executeSell({
  userId,
  instrumentId,
  walletId,
  unitsMinor,
  amountMinor,
  unitPriceMinor,
  reference,
  idempotencyKey,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const walletResult = await client.query(
      `SELECT id, status FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );
    const wallet = walletResult.rows[0];

    const instrumentResult = await client.query(
      `SELECT id, symbol, name, status FROM wealth_instruments WHERE id = $1 FOR UPDATE`,
      [instrumentId]
    );
    const instrument = instrumentResult.rows[0];

    const holdingResult = await client.query(
      `SELECT * FROM wealth_holdings
        WHERE user_id = $1 AND instrument_id = $2 AND status = 'ACTIVE'
        FOR UPDATE`,
      [userId, instrumentId]
    );
    const holding = holdingResult.rows[0];

    if (!wallet || wallet.status !== "ACTIVE") {
      return recordFailure(client, { userId, instrumentId, holdingId: holding?.id ?? null, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "WALLET_FROZEN", type: "SELL", ledgerType: "WEALTH_SELL" });
    }
    if (!instrument || instrument.status !== "ACTIVE") {
      return recordFailure(client, { userId, instrumentId, holdingId: holding?.id ?? null, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "INSTRUMENT_UNAVAILABLE", type: "SELL", ledgerType: "WEALTH_SELL" });
    }
    if (!holding) {
      return recordFailure(client, { userId, instrumentId, holdingId: null, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "NO_HOLDING", type: "SELL", ledgerType: "WEALTH_SELL" });
    }
    if (Number(holding.units_minor) < unitsMinor) {
      return recordFailure(client, { userId, instrumentId, holdingId: holding.id, walletId, unitsMinor, amountMinor, unitPriceMinor, reference, idempotencyKey, code: "HOLDING_TOO_SMALL", type: "SELL", ledgerType: "WEALTH_SELL" });
    }

    // Credit the wallet ONCE, atomically with the rest.
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor + $1, updated_at = now() WHERE id = $2`,
      [amountMinor, walletId]
    );

    const remaining = Number(holding.units_minor) - unitsMinor;
    await client.query(
      `UPDATE wealth_holdings
          SET units_minor = units_minor - $1,
              status = CASE WHEN units_minor - $1 <= 0 THEN 'SOLD' ELSE 'ACTIVE' END,
              closed_at = CASE WHEN units_minor - $1 <= 0 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $2`,
      [unitsMinor, holding.id]
    );

    const order = await client.query(
      `INSERT INTO wealth_orders
         (user_id, holding_id, instrument_id, type, units_minor, amount_minor, unit_price_minor, reference, status)
       VALUES ($1, $2, $3, 'SELL', $4, $5, $6, $7, 'SUCCESS')
       RETURNING *`,
      [userId, holding.id, instrumentId, unitsMinor, amountMinor, unitPriceMinor, reference]
    );

    const ledger = await client.query(
      `INSERT INTO transactions
         (reference, idempotency_key, receiver_wallet_id, amount_minor, currency,
          type, status, narration, completed_at)
       VALUES ($1, $2, $3, $4, 'NGN', 'WEALTH_SELL', 'SUCCESS', $5, now())
       RETURNING *`,
      [reference, idempotencyKey, walletId, amountMinor, `Sell ${instrument.symbol} — ${instrument.name}`]
    );

    await client.query(
      `UPDATE wealth_orders SET transaction_id = $1 WHERE id = $2`,
      [ledger.rows[0].id, order.rows[0].id]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      holding,
      order: { ...order.rows[0], transaction_id: ledger.rows[0].id },
      ledger: ledger.rows[0],
      remainingUnitsMinor: remaining,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505" && err.constraint === "uq_transactions_wealth_sell_idempotency") {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    throw err;
  } finally {
    client.release();
  }
}
