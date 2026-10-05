// wallet controller — thin HTTP layer. The user id ALWAYS comes from the
// authenticated session (req.user.id), never from a request parameter.

import { asyncHandler } from "../utils/errors.js";
import { getWalletForUser } from "../services/walletService.js";
import { fundWallet } from "../services/fundService.js";

export const getWallet = asyncHandler(async (req, res) => {
  const wallet = await getWalletForUser(req.user.id);
  res.json({ success: true, data: { wallet } });
});

// Top-up the wallet (simulated gateway). Idempotency key → single credit.
export const fund = asyncHandler(async (req, res) => {
  const data = await fundWallet({
    userId: req.user.id,
    amountMinor: req.body.amountMinor,
    idempotencyKey: req.idempotencyKey,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  res.status(201).json({ success: true, data });
});