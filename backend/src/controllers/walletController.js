// wallet controller — thin HTTP layer. The user id ALWAYS comes from the
// authenticated session (req.user.id), never from a request parameter.

import { asyncHandler } from "../utils/errors.js";
import { getWalletForUser } from "../services/walletService.js";
import { fundWallet } from "../services/fundService.js";
import { getVirtualAccount } from "../services/virtualAccountService.js";

export const getWallet = asyncHandler(async (req, res) => {
  const wallet = await getWalletForUser(req.user.id);
  res.json({ success: true, data: { wallet } });
});

// The user's stable "dedicated account" for bank-transfer top-ups.
export const getVirtualAccountHandler = asyncHandler(async (req, res) => {
  const virtualAccount = await getVirtualAccount(req.user.id);
  res.json({ success: true, data: { virtualAccount } });
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