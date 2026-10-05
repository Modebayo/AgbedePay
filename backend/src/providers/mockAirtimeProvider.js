// MOCK airtime provider — DEVELOPMENT ONLY.
// No real top-up is sent; a clearly-labelled reference is returned and the
// wallet debit + AIRTIME ledger record are 100% real. Swapping in a real
// provider (VTPass, TrueBalance, …) only changes this file.

const NETWORKS = [
  { network: "MTN", label: "MTN Nigeria" },
  { network: "GLO", label: "Globacom" },
  { network: "AIRTEL", label: "Airtel Nigeria" },
  { network: "9MOBILE", label: "9mobile" },
];

export function listNetworks() {
  return NETWORKS;
}

export async function purchaseAirtime({ network, phone, amountMinor }) {
  return {
    network,
    phone,
    amountMinor,
    reference: `MOCK-AIRTIME-${Date.now().toString(36).toUpperCase()}`,
    provider: "mock-airtime",
    devOnly: true,
  };
}