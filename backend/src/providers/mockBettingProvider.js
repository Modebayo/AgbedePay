// MOCK betting provider — DEVELOPMENT ONLY.
// No real account is topped up; a clearly-labelled reference is returned and
// the wallet debit + BETTING ledger record are 100% real. Swapping in a real
// aggregator (Paystack, Interswitch, …) only changes this file.

const PLATFORMS = [
  { platform: "BET9JA", label: "Bet9ja", accent: "#2bb673" },
  { platform: "SPORTYBET", label: "SportyBet", accent: "#8b5cf6" },
  { platform: "1XBET", label: "1xBet", accent: "#1f6feb" },
  { platform: "MERRYBET", label: "Merrybet", accent: "#f59e0b" },
  { platform: "BETKING", label: "BetKing", accent: "#e23838" },
];

export function listBettingPlatforms() {
  return PLATFORMS;
}

// Mock "who does this customer ID belong to" — a lookup, never a charge.
export async function lookupBettingAccount({ platform, customerId }) {
  const label = PLATFORMS.find((p) => p.platform === platform)?.label ?? platform;
  return {
    platform,
    customerId,
    label,
    name: `${label} FAN ${String(customerId).slice(0, 4).toUpperCase()}`,
    active: true,
  };
}

export async function fundBettingAccount({ platform, customerId, amountMinor }) {
  return {
    platform,
    customerId,
    amountMinor,
    reference: `MOCK-BET-${Date.now().toString(36).toUpperCase()}`,
    provider: "mock-betting",
    devOnly: true,
  };
}