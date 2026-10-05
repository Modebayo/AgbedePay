// wallet service — business rules about wallets.
// The balance ALWAYS comes from the database, never from the client.

import * as walletModel from "../models/wallets.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";
import { formatNaira } from "../utils/money.js";

// Read a wallet for display: integer kobo + a human-formatted string.
// There is NO float anywhere in this path.
export async function getWalletForUser(userId) {
  const wallet = await walletModel.findByUserId(userId);
  if (!wallet) throw new ApiError(404, "Wallet not found", "WALLET_NOT_FOUND");

  return {
    id: wallet.id,
    currency: wallet.currency,
    balanceMinor: wallet.balance_minor,
    balanceNgn: formatNaira(wallet.balance_minor),
    status: wallet.status,
    updatedAt: wallet.updated_at,
  };
}

// Used by EVERY money-moving operation (Phase 7+): a wallet must exist and be
// ACTIVE before anything crosses it. FROZEN wallets refuse to move money.
export async function assertWalletActive(userId) {
  const wallet = await walletModel.findByUserId(userId);
  if (!wallet) throw new ApiError(404, "Wallet not found", "WALLET_NOT_FOUND");
  if (wallet.status !== "ACTIVE") {
    throw new ApiError(403, "Wallet is frozen", "WALLET_FROZEN");
  }
  return wallet;
}