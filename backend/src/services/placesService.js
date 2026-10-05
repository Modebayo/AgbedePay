// places service — saved pickup/dropoff favourites.
// A favourite is per-user and unique by (user, LABEL); a duplicate label is a
// 409, not a second row.

import * as placesModel from "../models/userPlaces.js";
import * as auditModel from "../models/audit.js";
import { ApiError } from "../utils/errors.js";

export async function list(userId) {
  const rows = await placesModel.listForUser(userId);
  return {
    places: rows.map((p) => ({
      id: p.id,
      label: p.label,
      address: p.address,
      contactPhone: p.contact_phone,
      createdAt: p.created_at,
    })),
  };
}

export async function create({ userId, label, address, contactPhone, ipAddress, userAgent }) {
  try {
    const place = await placesModel.create({ userId, label, address, contactPhone });
    await auditModel.record({
      userId,
      action: "PLACE_SAVED",
      entityType: "USER_PLACE",
      entityId: place.id,
      metadata: { label, address },
      ipAddress,
      userAgent,
    });
    return {
      place: {
        id: place.id,
        label: place.label,
        address: place.address,
        contactPhone: place.contact_phone,
        createdAt: place.created_at,
      },
    };
  } catch (err) {
    if (err.code === "23505" && err.constraint === "uq_user_places_user_label") {
      throw new ApiError(409, `You already saved a place called "${label}"`, "PLACE_EXISTS");
    }
    throw err;
  }
}