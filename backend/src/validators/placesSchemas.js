// Validation schema for saved places (user_places favourites).

export const placeSchema = {
  label: ["required", "string", ["maxLen", 24]],
  address: ["required", "string", ["minLen", 3], ["maxLen", 180]],
  contactPhone: ["optional", "string", "phone"],
};