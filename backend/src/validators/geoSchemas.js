// Validation schema for the geo endpoints.

// origin / destination may be an address string OR a { lat, lng } object, so we
// only assert presence here and let the service normalise the shape.
export const geoRouteSchema = {
  origin: ["required"],
  destination: ["required"],
};
