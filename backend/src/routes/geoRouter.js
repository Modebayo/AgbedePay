// /api/geo — maps configuration, route computation, and Places autocomplete.
// Auth-gated so anonymous traffic can't burn the Maps quota.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { validate } from "../validators/validate.js";
import { geoRouteSchema } from "../validators/geoSchemas.js";
import * as geoController from "../controllers/geoController.js";

const router = Router();

router.get("/config", requireAuth, geoController.config);

router.post("/route", requireAuth, validate(geoRouteSchema), geoController.route);

router.get("/places", requireAuth, geoController.places);

export default router;
