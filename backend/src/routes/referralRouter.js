// /api/referrals/* — read-only referral stats for the logged-in user.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import * as referralController from "../controllers/referralController.js";

const router = Router();

router.get("/", requireAuth, referralController.myStats);

export default router;