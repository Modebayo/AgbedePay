// audit_logs model — the immutable security/finance event trail.
// NEVER put PINs, passwords, OTP codes or tokens in here.

import { query } from "../config/db.js";

export async function record({
  userId = null,
  action,
  entityType = null,
  entityId = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [userId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, ipAddress, userAgent]
  );
}