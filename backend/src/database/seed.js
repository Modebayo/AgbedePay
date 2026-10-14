// Development seed data — clearly-fake users so you can test relationships.
// Uses fixed IDs and ON CONFLICT DO NOTHING, so it's safe to run repeatedly.
// The wallet math is CONSISTENT with the transactions created here:
//   Ada wallet   = +25,500,000 (funding) - 5,000,000 (send) - 10,000,000 (savings)
//                  - 4,815,000 (wealth buys) + 429,000 (wealth sell)
//                  = 6,114,000  (₦61,140.00)
//   Chidi wallet = +5,000,000 (received) = 5,000,000
// Ada additionally HOLDS ₦43,860.00 of investments, so her total wealth is
// ₦105,000.00 — the same figure she had before Wealth existed, which is the
// point: moving money into an investment moves it, it does not create it.
// Login PIN for both seeded users is: 482913
import { pool } from "../config/db.js";
import { hashPin } from "../utils/crypto.js";
import { UNIT_SCALE, unitsToAmountMinor } from "../models/wealthModel.js";
// The instrument catalogue lives in its own module. It is reference data that
// depends on no user and no wallet, so it has to be applyable on its own to a
// database whose full seed can no longer run — see the note in that file.
// Imported, never copied, so the two can never disagree.
import { INSTRUMENTS, applyCatalogue } from "./wealthCatalogue.js";

// Ensure the seeded users can log in with a known dev PIN (Argon2id-hashed).
const SEED_PIN = "482913";
const PIN_HASH = await hashPin(SEED_PIN);

const INSERT_USER = `
  INSERT INTO users (id, full_name, phone, email, pin_hash, status, is_verified)
  VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true)
  ON CONFLICT (id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash`;

const INSERT_WALLET = `
  INSERT INTO wallets (id, user_id, balance_minor)
  VALUES ($1, $2, $3)
  ON CONFLICT (id) DO NOTHING`;

const INSERT_GOAL = `
  INSERT INTO savings_goals (id, user_id, name, target_amount_minor, current_amount_minor, target_date)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (id) DO NOTHING`;

const INSERT_TX = `
  INSERT INTO transactions
    (reference, idempotency_key, sender_wallet_id, receiver_wallet_id,
     amount_minor, type, status, narration, completed_at)
  VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, now())
  ON CONFLICT (reference) DO NOTHING`;

// Same shape as INSERT_TX but RETURNING the new id (so wealth_orders can link
// to a real ledger row) and taking an explicit created_at, so the seeded
// history has a believable spread of dates instead of everything "just now".
const INSERT_TX_RETURNING = `
  INSERT INTO transactions
    (reference, idempotency_key, sender_wallet_id, receiver_wallet_id,
     amount_minor, type, status, narration, completed_at)
  VALUES ($1, NULL, $2, $3, $4, $5, 'SUCCESS', $6, $7)
  ON CONFLICT (reference) DO UPDATE SET reference = EXCLUDED.reference
  RETURNING id`;

const INSERT_SAV_TX = `
  INSERT INTO savings_transactions (goal_id, user_id, amount_minor, type, reference)
  VALUES ($1, $2, $3, 'DEPOSIT', $4)
  ON CONFLICT (reference) DO NOTHING`;
const INSERT_HOLDING = `
  INSERT INTO wealth_holdings
    (id, user_id, instrument_id, units_minor, avg_cost_minor, status)
  VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
  ON CONFLICT (id) DO NOTHING`;

const INSERT_WEALTH_ORDER = `
  INSERT INTO wealth_orders
    (id, user_id, holding_id, instrument_id, type, units_minor, amount_minor,
     unit_price_minor, reference, transaction_id, status, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUCCESS', $11)
  ON CONFLICT (reference) DO NOTHING`;

const INSERT_WEALTH_GOAL = `
  INSERT INTO wealth_goals
    (id, user_id, name, target_age, current_age, target_amount_minor,
     current_amount_minor, monthly_contribution_minor, target_date)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (id) DO NOTHING`;

// Drivers and admins are ordinary users with a role. Keeping them here means
// the local stack has someone to accept ride/dispatch offers and someone to
// approve them. Re-running the seed always (re)sets the role, so a user who
// was promoted can be reset cleanly.
const SET_ROLE = `UPDATE users SET role = $2 WHERE id = $1`;

const INSERT_DRIVER_PROFILE = `
  INSERT INTO driver_profiles
    (user_id, vehicle_type, car_make_model, car_color, plate_number,
     commission_bp, rating, trips_completed, status, is_online, last_seen_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
  ON CONFLICT (user_id) DO UPDATE SET
    vehicle_type = EXCLUDED.vehicle_type,
    car_make_model = EXCLUDED.car_make_model,
    car_color = EXCLUDED.car_color,
    plate_number = EXCLUDED.plate_number,
    status = EXCLUDED.status,
    is_online = EXCLUDED.is_online`;


const instrumentIdBySymbol = new Map(INSTRUMENTS.map(([id, symbol]) => [symbol, id]));

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const ADA = "11111111-1111-4111-8111-111111111111";
  const CHIDI = "22222222-2222-4222-8222-222222222222";
  const DRIVER = "33333333-3333-4333-8333-333333333333";
  const ADMIN = "44444444-4444-4444-8444-444444444444";
  const ADA_WALLET = "a1111111-1111-4111-8111-111111111111";
  const CHIDI_WALLET = "a2222222-2222-4222-8222-222222222222";
  const DRIVER_WALLET = "a3333333-3333-4333-8333-333333333333";
  const ADMIN_WALLET = "a4444444-4444-4444-8444-444444444444";
  const ADA_GOAL = "c1111111-1111-4111-8111-111111111111";

  await client.query(INSERT_USER, [ADA, "Ada Obi", "08012345678", "ada@example.com", PIN_HASH]);
  await client.query(INSERT_USER, [CHIDI, "Chidi Nwosu", "08087654321", "chidi@example.com", PIN_HASH]);
  await client.query(INSERT_USER, [DRIVER, "Ngozi Eze", "08033333333", "ngozi@example.com", PIN_HASH]);
  await client.query(INSERT_USER, [ADMIN, "Agbede Admin", "08044444444", "admin@example.com", PIN_HASH]);

  await client.query(SET_ROLE, [ADA, "CUSTOMER"]);
  await client.query(SET_ROLE, [CHIDI, "CUSTOMER"]);
  await client.query(SET_ROLE, [DRIVER, "DRIVER"]);
  await client.query(SET_ROLE, [ADMIN, "ADMIN"]);

  // Ada's balance is the sum of the movements below; see the header comment.
  await client.query(INSERT_WALLET, [ADA_WALLET, ADA, 6114000]); // ₦61,140.00
  await client.query(INSERT_WALLET, [CHIDI_WALLET, CHIDI, 5000000]); // ₦50,000.00
  await client.query(INSERT_WALLET, [DRIVER_WALLET, DRIVER, 0]); // earnings land here
  await client.query(INSERT_WALLET, [ADMIN_WALLET, ADMIN, 0]);

  // The seeded driver is approved and on the road, so a ride/dispatch booked in
  // dev can actually be offered to someone.
  await client.query(INSERT_DRIVER_PROFILE, [
    DRIVER, "CAR", "Toyota Corolla 2018", "Silver", "KJA-234XY", 1500, 4.9, 128, "ACTIVE", true,
  ]);

  // Goal: New Laptop — target ₦800,000, currently ₦100,000.
  await client.query(INSERT_GOAL, [ADA_GOAL, ADA, "New Laptop", 80000000, 10000000, "2026-12-31"]);

  // The three money movements that make the balances above true.
  await client.query(INSERT_TX, ["TXN-FUND-MOCK-001", null, ADA_WALLET, 25500000, "FUNDING", "SUCCESS", "Mock wallet top-up"]);
  await client.query(INSERT_TX, ["TXN-SEND-MOCK-001", ADA_WALLET, CHIDI_WALLET, 5000000, "TRANSFER", "SUCCESS", "Rent split"]);
  await client.query(INSERT_TX, ["TXN-SAV-MOCK-001", ADA_WALLET, null, 10000000, "SAVINGS_DEPOSIT", "SUCCESS", "Deposit to New Laptop"]);

  await client.query(INSERT_SAV_TX, [ADA_GOAL, ADA, 10000000, "SAV-DEP-MOCK-001"]);

  // ---- Wealth: the investment catalogue ----
  // Delegated to the shared module so the full seed and a catalogue-only
  // backfill can never end up with different instruments or different
  // maturities. See backend/src/database/wealthCatalogue.js.
  await applyCatalogue(client);

  // ---- Wealth: Ada's positions and the orders that built them ----
  //
  // Amounts are derived, never typed twice: unitsToAmountMinor() is the same
  // maths the model uses, so the seeded rows and a live order can never
  // disagree about what a position cost.
  const MTNN = instrumentIdBySymbol.get("MTNN");
  const DANGCEM = instrumentIdBySymbol.get("DANGCEM");
  const FGN_2031 = instrumentIdBySymbol.get("FGN-BOND-2031");
  const MONEY_FUND = instrumentIdBySymbol.get("FUND-MONEY");

  const HOLDING_MTNN = "e0000000-0000-4000-8000-000000000001";
  const HOLDING_DANGCEM = "e0000000-0000-4000-8000-000000000002";
  const HOLDING_FGN = "e0000000-0000-4000-8000-000000000003";
  const HOLDING_FUND = "e0000000-0000-4000-8000-000000000004";

  // Bought 20 MTNN at ₦820, then sold 5 at ₦858 — so the holding is 15 units
  // and the history has both a BUY and a SELL to show.
  const mtnnBuyUnits = 20 * UNIT_SCALE;
  const mtnnBuyPrice = 82000; // ₦820.00
  const mtnnSellUnits = 5 * UNIT_SCALE;
  const mtnnSellPrice = 85800; // ₦858.00

  const mtnnHeldUnits = mtnnBuyUnits - mtnnSellUnits;
  const mtnnBuyAmount = unitsToAmountMinor(mtnnBuyUnits, mtnnBuyPrice);
  const mtnnSellAmount = unitsToAmountMinor(mtnnSellUnits, mtnnSellPrice);

  const dangcemUnits = 15 * UNIT_SCALE;
  const dangcemPrice = 102000; // ₦1,020.00
  const dangcemAmount = unitsToAmountMinor(dangcemUnits, dangcemPrice);

  const fgnUnits = 1000 * UNIT_SCALE;
  const fgnPrice = 100; // face value, ₦1.00 per unit
  const fgnAmount = unitsToAmountMinor(fgnUnits, fgnPrice);

  const fundUnits = 150 * UNIT_SCALE;
  const fundPrice = 10300; // ₦103.00
  const fundAmount = unitsToAmountMinor(fundUnits, fundPrice);

  await client.query(INSERT_HOLDING, [HOLDING_MTNN, ADA, MTNN, mtnnHeldUnits, mtnnBuyPrice]);
  await client.query(INSERT_HOLDING, [HOLDING_DANGCEM, ADA, DANGCEM, dangcemUnits, dangcemPrice]);
  await client.query(INSERT_HOLDING, [HOLDING_FGN, ADA, FGN_2031, fgnUnits, fgnPrice]);
  await client.query(INSERT_HOLDING, [HOLDING_FUND, ADA, MONEY_FUND, fundUnits, fundPrice]);

  // Wallet-level ledger rows for the four buys and the one sell. RETURNING id
  // so wealth_orders.transaction_id points at a real row, not a guess.
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

  const buyTx = {};
  const wealthBuys = [
    ["BUY-MOCK-MTNN", MTNN, mtnnBuyAmount, `Buy MTNN — MTN Nigeria Communications Plc`, 21],
    ["BUY-MOCK-DANGCEM", DANGCEM, dangcemAmount, `Buy DANGCEM — Dangote Cement Plc`, 14],
    ["BUY-MOCK-FGN2031", FGN_2031, fgnAmount, "Buy FGN-BOND-2031 — FGN Bond due 2031", 9],
    ["BUY-MOCK-FUNDMM", MONEY_FUND, fundAmount, "Buy FUND-MONEY — AgbedePay Money Market Fund", 5],
  ];
  for (const [ref, symbol, amount, narration, days] of wealthBuys) {
    const { rows } = await client.query(INSERT_TX_RETURNING, [`TXN-${ref}`, ADA_WALLET, null, amount, "WEALTH_BUY", narration, daysAgo(days)]);
    buyTx[symbol] = rows[0].id;
  }

  const { rows: sellRows } = await client.query(
    INSERT_TX_RETURNING,
    ["TXN-SELL-MOCK-MTNN", null, ADA_WALLET, mtnnSellAmount, "WEALTH_SELL", "Sell MTNN — MTN Nigeria Communications Plc", daysAgo(3)]
  );

  const wealthOrders = [
    ["f0000000-0000-4000-8000-000000000001", HOLDING_MTNN, MTNN, "BUY", mtnnBuyUnits, mtnnBuyAmount, mtnnBuyPrice, "BUY-MOCK-MTNN", buyTx[MTNN], daysAgo(21)],
    ["f0000000-0000-4000-8000-000000000002", HOLDING_DANGCEM, DANGCEM, "BUY", dangcemUnits, dangcemAmount, dangcemPrice, "BUY-MOCK-DANGCEM", buyTx[DANGCEM], daysAgo(14)],
    ["f0000000-0000-4000-8000-000000000003", HOLDING_FGN, FGN_2031, "BUY", fgnUnits, fgnAmount, fgnPrice, "BUY-MOCK-FGN2031", buyTx[FGN_2031], daysAgo(9)],
    ["f0000000-0000-4000-8000-000000000004", HOLDING_FUND, MONEY_FUND, "BUY", fundUnits, fundAmount, fundPrice, "BUY-MOCK-FUNDMM", buyTx[MONEY_FUND], daysAgo(5)],
    ["f0000000-0000-4000-8000-000000000005", HOLDING_MTNN, MTNN, "SELL", mtnnSellUnits, mtnnSellAmount, mtnnSellPrice, "SELL-MOCK-MTNN", sellRows[0].id, daysAgo(3)],
  ];
  for (const [id, holdingId, instId, type, units, amount, price, ref, txId, when] of wealthOrders) {
    await client.query(INSERT_WEALTH_ORDER, [id, ADA, holdingId, instId, type, units, amount, price, ref, txId, when]);
  }

  // A retirement goal, so the Retirement Goal page has something to project.
  // The starting amount is her ACTUAL net cost basis across all four holdings
  // (buys minus sells), not a number typed alongside them.
  const netCostBasis =
    mtnnBuyAmount - mtnnSellAmount + dangcemAmount + fgnAmount + fundAmount;
  await client.query(INSERT_WEALTH_GOAL, [
    "d1000000-0000-4000-8000-000000000001",
    ADA,
    "Retire at 60",
    60,
    31,
    5000000000, // ₦50,000,000.00
    netCostBasis,
    25000000, // ₦250,000.00 a month
    "2056-09-28",
  ]);

  // Guard the arithmetic the header comment promises. A seed whose numbers do
  // not add up teaches the wrong lesson, and it is far too easy to edit one
  // position and not the ledger. Totals are summed from the same variables the
  // rows were built from, so this check cannot drift from the data.
  const ADA_OPENING_FUNDING = 25500000;
  const ADA_SEND = 5000000;
  const ADA_SAVINGS = 10000000;
  const totalBuys = wealthBuys.reduce((sum, [, , amount]) => sum + amount, 0);

  const { rows: checkRows } = await client.query(
    `SELECT balance_minor FROM wallets WHERE id = $1`,
    [ADA_WALLET]
  );
  const expectedAda =
    ADA_OPENING_FUNDING - ADA_SEND - ADA_SAVINGS - totalBuys + mtnnSellAmount;
  if (Number(checkRows[0].balance_minor) !== expectedAda) {
    throw new Error(
      `Seed arithmetic broken: Ada wallet is ${checkRows[0].balance_minor}, expected ${expectedAda}`
    );
  }

  await client.query("COMMIT");
  console.log("Seeded development data: Ada + Chidi + driver (Ngozi) + admin users, wallets,");
  console.log(" 1 driver profile, 1 savings goal, 3 transactions,");
  console.log(" 19 wealth instruments, 4 holdings, 5 wealth orders, 1 retirement goal.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Seeding failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}