// wallets model — every SQL statement about wallets lives here.

import { query } from "../config/db.js";

export async function findByUserId(userId) {
  const { rows } = await query(
    `SELECT id, user_id, currency, balance_minor, status, created_at, updated_at
       FROM wallets
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

// Find a wallet by the owner's PHONE, joining users — demonstrates the
// relationship between the two tables in a real query.
export async function findByOwnerPhone(phone) {
  const { rows } = await query(
    `SELECT w.id, w.currency, w.balance_minor, w.status, w.updated_at
       FROM wallets w
       JOIN users u ON u.id = w.user_id
      WHERE u.phone = $1`,
    [phone]
  );
  return rows[0] ?? null;
}

// Find a wallet by the owner's AgbedePay ACCOUNT NUMBER (migration 036) — the
// bankless alternative to a phone lookup for wallet-to-wallet transfers.
export async function findByOwnerAccountNumber(accountNumber) {
  const { rows } = await query(
    `SELECT w.id, w.currency, w.balance_minor, w.status, w.updated_at
       FROM wallets w
       JOIN users u ON u.id = w.user_id
      WHERE u.account_number = $1`,
    [accountNumber]
  );
  return rows[0] ?? null;
}

// The OWNER of a wallet, by wallet id — e.g. to notify the receiver of a transfer.
export async function findUserIdByWalletId(walletId) {
  const { rows } = await query(`SELECT user_id FROM wallets WHERE id = $1`, [walletId]);
  return rows[0]?.user_id ?? null;
}

// A new wallet always starts at 0 kobo and is created at registration.
export async function createForUser(userId) {
  const { rows } = await query(
    `INSERT INTO wallets (user_id)
     VALUES ($1)
     RETURNING id, user_id, currency, balance_minor, status, created_at`,
    [userId]
  );
  return rows[0];
}