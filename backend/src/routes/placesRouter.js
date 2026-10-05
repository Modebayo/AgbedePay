// /api/places — saved pickup/dropoff favourites used by the ride/dispatch pages.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { validate } from "../validators/validate.js";
import { placeSchema } from "../validators/placesSchemas.js";
import * as placesController from "../controllers/placesController.js";

const router = Router();

router.get("/", requireAuth, placesController.list);

router.post("/", requireAuth, validate(placeSchema), placesController.create);

export default router;