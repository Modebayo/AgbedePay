// /api/support — Help & Support: raise a ticket, read your own threads.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { validate } from "../validators/validate.js";
import { supportTicketSchema } from "../validators/supportSchemas.js";
import * as supportController from "../controllers/supportController.js";

const router = Router();

router.get("/tickets", requireAuth, supportController.list);

router.post("/tickets", requireAuth, validate(supportTicketSchema), supportController.create);

export default router;
