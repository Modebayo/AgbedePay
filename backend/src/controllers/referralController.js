// referral controller — thin HTTP layer for the referral programme.

import { asyncHandler } from "../utils/errors.js";
import * as referralService from "../services/referralService.js";

export const myStats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await referralService.myReferralStats(req.user.id) });
});