// user_places model — saved pick-up/drop-off favourites (Home, Office, …).
// One favourite per label per person (unique index uq_user_places_user_label).

import { query } from "../config/db.js";

export async function listForUser(userId) {
  const { rows } = await query(
    `SELECT id, label, address, contact_phone, created_at
       FROM user_places
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function create({ userId, label, address, contactPhone }) {
  const { rows } = await query(
    `INSERT INTO user_places (user_id, label, address, contact_phone)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, address, contact_phone, created_at`,
    [userId, label, address, contactPhone ?? null]
  );
  return rows[0];
}