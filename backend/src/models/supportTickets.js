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

// ---------- Admin queue ----------

// Every ticket with the requester's identity, for the admin console. Open
// tickets sort ahead of answered ones so the desk works top-down.
export async function listAll({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT st.id, st.user_id, st.reference, st.category, st.subject, st.message,
            st.status, st.agent_reply, st.replied_at, st.resolved_at,
            st.created_at, st.updated_at, u.full_name AS user_name, u.phone AS user_phone
       FROM support_tickets st
       JOIN users u ON u.id = st.user_id
      WHERE ($1::text IS NULL OR st.status = $1)
      ORDER BY (st.status = 'OPEN') DESC, st.created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM support_tickets WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// Record an agent reply and (optionally) set the new status. resolved_at is
// stamped only on the transition into RESOLVED.
export async function reply({ id, agentReply, status = "IN_PROGRESS" }) {
  const { rows } = await query(
    `UPDATE support_tickets
        SET agent_reply = $2,
            status = $3::varchar,
            replied_at = now(),
            resolved_at = CASE WHEN $3::varchar = 'RESOLVED' THEN now() ELSE resolved_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, agentReply, status]
  );
  return rows[0] ?? null;
}
