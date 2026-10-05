// market controller — thin HTTP layer for /api/market.
// Public read-only endpoint: returns the real-time fintech data snapshot.

import { asyncHandler } from "../utils/errors.js";
import { getMarketWithFallback } from "../services/marketService.js";

export const getMarket = asyncHandler(async (_req, res) => {
  const data = await getMarketWithFallback();
  res.json({ success: true, data });
});