// virtual accounts model — a stable per-user funding account number.

import { query } from "../config/db.js";

export async function findByUserId(userId) {
  const { rows } = await query(
    `SELECT id, user_id, account_number, account_name, bank_name, provider, created_at
       FROM virtual_accounts WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function create({ userId, accountNumber, accountName, bankName, provider = "mock" }) {
  const { rows } = await query(
    `INSERT INTO virtual_accounts (user_id, account_number, account_name, bank_name, provider)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET account_number = virtual_accounts.account_number
     RETURNING id, user_id, account_number, account_name, bank_name, provider, created_at`,
    [userId, accountNumber, accountName, bankName, provider]
  );
  return rows[0] ?? null;
}
