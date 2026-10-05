// /api/market — real-time fintech data (FX + crypto) for the dashboard.
// Public: these are market display numbers, not account data.

import { Router } from "express";
import * as marketController from "../controllers/marketController.js";

const router = Router();

router.get("/", marketController.getMarket);

export default router;