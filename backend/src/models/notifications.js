// notifications model — the ONLY SQL about notifications lives here.

import { query } from "../config/db.js";

export async function create({ userId, type, title, body, link }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, type, title, body, link, read_at, created_at`,
    [userId, type, title, body ?? null, link ?? null]
  );
  return rows[0] ?? null;
}

export async function listByUser({ userId, limit = 20, unreadOnly = false }) {
  const where = unreadOnly ? "user_id = $1 AND read_at IS NULL" : "user_id = $1";
  const { rows } = await query(
    `SELECT id, type, title, body, link, read_at, created_at
       FROM notifications
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function unreadCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return rows[0].total;
}

export async function markRead(userId, notificationId) {
  const { rows } = await query(
    `UPDATE notifications SET read_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [notificationId, userId]
  );
  return rows[0] ?? null;
}

export async function markAllRead(userId) {
  await query(
    `UPDATE notifications SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}