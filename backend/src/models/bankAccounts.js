// bank accounts model — payout destinations (cash-out) AND beneficiaries
// (send-money-to-bank). The `kind` column keeps the two lists separate:
// PAYOUT accounts are the user's OWN linked bank details for cashing out,
// BENEFICIARY accounts are people the user has sent money to.

import { query } from "../config/db.js";

export async function create({ userId, bankName, accountName, accountNumber, kind = "PAYOUT" }) {
  const { rows } = await query(
    `INSERT INTO bank_accounts (user_id, bank_name, account_name, account_number, kind)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, bank_name, account_name, account_number, kind, created_at`,
    [userId, bankName, accountName, accountNumber, kind]
  );
  return rows[0] ?? null;
}

export async function listForUser(userId, kind = "PAYOUT") {
  const { rows } = await query(
    `SELECT id, bank_name, account_name, account_number, kind, created_at
       FROM bank_accounts
      WHERE user_id = $1 AND kind = $2
      ORDER BY created_at DESC`,
    [userId, kind]
  );
  return rows;
}

export async function countForUser(userId, kind = "PAYOUT") {
  const { rows } = await query(
    `SELECT count(*)::int AS total FROM bank_accounts WHERE user_id = $1 AND kind = $2`,
    [userId, kind]
  );
  return rows[0].total;
}

export async function findByOwnedId(userId, id) {
  const { rows } = await query(
    `SELECT id, bank_name, account_name, account_number, kind, created_at
       FROM bank_accounts
      WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] ?? null;
}

export async function findBeneficiary(userId, bankName, accountNumber, kind = "BENEFICIARY") {
  const { rows } = await query(
    `SELECT id, bank_name, account_name, account_number, kind, created_at
       FROM bank_accounts
      WHERE user_id = $1 AND kind = $2 AND bank_name = $3 AND account_number = $4`,
    [userId, kind, bankName, accountNumber]
  );
  return rows[0] ?? null;
}

export async function removeById(userId, id) {
  const { rows } = await query(
    `DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return rows[0] ?? null;
}