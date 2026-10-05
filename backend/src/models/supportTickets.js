// supportTickets model — all SQL for help & support tickets lives here.

import { query } from "../config/db.js";

const COLUMNS = `id, user_id, reference, category, subject, message, status,
                 agent_reply, replied_at, resolved_at, created_at, updated_at`;

export async function create({ userId, reference, category, subject, message }) {
  const { rows } = await query(
    `INSERT INTO support_tickets (user_id, reference, category, subject, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [userId, reference, category, subject, message]
  );
  return rows[0] ?? null;
}

export async function listForUser(userId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM support_tickets
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function findOpenByCategory(userId, category) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM support_tickets
      WHERE user_id = $1 AND category = $2 AND status IN ('OPEN', 'IN_PROGRESS')
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, category]
  );
  return rows[0] ?? null;
}

export async function countSince(userId, since) {
  const { rows } = await query(
    `SELECT count(*)::int AS count FROM support_tickets
      WHERE user_id = $1 AND created_at >= $2`,
    [userId, since]
  );
  return rows[0]?.count ?? 0;
}
