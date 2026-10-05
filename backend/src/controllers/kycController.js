// kyc controller — thin HTTP layer for bio-data + identity verification.

import { asyncHandler } from "../utils/errors.js";
import * as kycService from "../services/kycService.js";

const reqCtx = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const get = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kycService.getKyc(req.user.id) });
});

export const limits = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kycService.getLimits(req.user.id) });
});

export const updateBio = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await kycService.updateBioData(req.user.id, req.body, reqCtx(req)) });
});

export const verifyIdentity = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await kycService.verifyIdentityNumber({
      userId: req.user.id,
      identityType: req.body.identityType,
      identityNumber: req.body.identityNumber,
      pin: req.body.pin,
      ...reqCtx(req),
    }),
  });
});