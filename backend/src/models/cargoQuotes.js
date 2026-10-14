// cargoQuotes model — all SQL for Agbede Cargo quotation requests.
//
// A cargo request is a lead, not a payment: it records what the customer wants
// moved and lands in a queue an admin prices offline. There is deliberately no
// wallet or ledger coupling here.

import { query } from "../config/db.js";

const COLUMNS = `id, user_id, reference, pickup_address, dropoff_address, cargo_type,
                 approx_weight_kg, dimensions, vehicle_requirements, collection_date,
                 contact_name, contact_phone, notes, status, quoted_amount_minor,
                 admin_note, created_at, updated_at`;

export async function create({
  userId,
  reference,
  pickupAddress,
  dropoffAddress,
  cargoType,
  approxWeightKg,
  dimensions,
  vehicleRequirements,
  collectionDate,
  contactName,
  contactPhone,
  notes,
}) {
  const { rows } = await query(
    `INSERT INTO cargo_quotes
       (user_id, reference, pickup_address, dropoff_address, cargo_type,
        approx_weight_kg, dimensions, vehicle_requirements, collection_date,
        contact_name, contact_phone, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${COLUMNS}`,
    [
      userId,
      reference,
      pickupAddress,
      dropoffAddress,
      cargoType,
      approxWeightKg ?? null,
      dimensions ?? null,
      vehicleRequirements ?? null,
      collectionDate ?? null,
      contactName,
      contactPhone,
      notes ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function listForUser(userId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM cargo_quotes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM cargo_quotes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// ---------- Admin queue ----------

// Every cargo request with the requester's identity, for the admin console.
// Unpriced requests (REQUESTED) float to the top so the queue reads as a to-do.
export async function listAll({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT cq.id, cq.user_id, cq.reference, cq.pickup_address, cq.dropoff_address,
            cq.cargo_type, cq.approx_weight_kg, cq.dimensions, cq.vehicle_requirements,
            cq.collection_date, cq.contact_name, cq.contact_phone, cq.notes, cq.status,
            cq.quoted_amount_minor, cq.admin_note, cq.created_at, cq.updated_at,
            u.full_name AS user_name, u.phone AS user_phone
       FROM cargo_quotes cq
       JOIN users u ON u.id = cq.user_id
      WHERE ($1::text IS NULL OR cq.status = $1)
      ORDER BY (cq.status = 'REQUESTED') DESC, cq.created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}

// Attach a price + note and/or move the request along. COALESCE keeps any field
// the admin didn't touch. There is no money movement here (see file header).
export async function setQuote({ id, quotedAmountMinor = null, adminNote = null, status = null }) {
  const { rows } = await query(
    `UPDATE cargo_quotes
        SET quoted_amount_minor = COALESCE($2, quoted_amount_minor),
            admin_note = COALESCE($3, admin_note),
            status = COALESCE($4, status),
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, quotedAmountMinor, adminNote, status]
  );
  return rows[0] ?? null;
}

// Cancel an open request. Only a request that hasn't been priced can be pulled,
// and only by its owner — enforced here so no caller can skip the rule.
export async function cancel({ id, userId }) {
  const { rows } = await query(
    `UPDATE cargo_quotes
        SET status = 'CANCELLED', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'REQUESTED'
      RETURNING ${COLUMNS}`,
    [id, userId]
  );
  return rows[0] ?? null;
}
