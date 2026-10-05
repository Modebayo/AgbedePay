// MOCK bills provider — DEVELOPMENT ONLY.
// Covers the three biller types we ship: prepaid/postpaid ELECTRICITY,
// MOBILE DATA and CABLE TV. Purchases return clearly-labelled mock references
// (electricity also gets a 20-digit token). Wallet debits + BILLS ledger rows
// are real; only the external fulfilment is simulated.

import crypto from "node:crypto";

// ---- Electricity distribution companies ------------------------------------

const DISCO_LIST = [
  { disCo: "IKEDC", label: "Ikeja Electric" },
  { disCo: "EKEDC", label: "Eko Electric" },
  { disCo: "AEDC", label: "Abuja Electric" },
  { disCo: "PHEDC", label: "Port Harcourt Electric" },
  { disCo: "KAEDC", label: "Kaduna Electric" },
  { disCo: "ENEDC", label: "Enugu Electric" },
  { disCo: "BEDC", label: "Benin Electric" },
  { disCo: "IBEDC", label: "Ibadan Electric" },
  { disCo: "JEDC", label: "Jos Electric" },
  { disCo: "KEDC", label: "Kano Electric" },
];

// ---- Mobile data plans -------------------------------------------------------

const DATA_PLANS = {
  MTN: [
    { planId: "mtn-500mb", label: "500MB — 30 days", amountMinor: 30000 },
    { planId: "mtn-1gb", label: "1GB — 30 days", amountMinor: 50000 },
    { planId: "mtn-2gb", label: "2GB — 30 days", amountMinor: 90000 },
    { planId: "mtn-5gb", label: "5GB — 30 days", amountMinor: 200000 },
  ],
  GLO: [
    { planId: "glo-300mb", label: "300MB — 7 days", amountMinor: 20000 },
    { planId: "glo-1gb", label: "1GB — 30 days", amountMinor: 48000 },
    { planId: "glo-2gb", label: "2GB — 30 days", amountMinor: 85000 },
    { planId: "glo-4.5gb", label: "4.5GB — 30 days", amountMinor: 180000 },
  ],
  AIRTEL: [
    { planId: "airtel-500mb", label: "500MB — 30 days", amountMinor: 35000 },
    { planId: "airtel-1gb", label: "1GB — 30 days", amountMinor: 60000 },
    { planId: "airtel-2gb", label: "2GB — 30 days", amountMinor: 100000 },
    { planId: "airtel-6gb", label: "6GB — 30 days", amountMinor: 220000 },
  ],
  "9MOBILE": [
    { planId: "9m-500mb", label: "500MB — 30 days", amountMinor: 32000 },
    { planId: "9m-1gb", label: "1GB — 30 days", amountMinor: 55000 },
    { planId: "9m-2gb", label: "2GB — 30 days", amountMinor: 95000 },
    { planId: "9m-5gb", label: "5GB — 30 days", amountMinor: 190000 },
  ],
};

// ---- Cable TV packages --------------------------------------------------------

const CABLE_PACKAGES = {
  DSTV: [
    { planId: "dstv-nova", label: "Nova", amountMinor: 230000 },
    { planId: "dstv-confam", label: "Confam", amountMinor: 490000 },
    { planId: "dstv-compact", label: "Compact", amountMinor: 820000 },
  ],
  GOTV: [
    { planId: "gotv-smallie", label: "Smallie", amountMinor: 100000 },
    { planId: "gotv-jinja", label: "Jinja", amountMinor: 170000 },
    { planId: "gotv-max", label: "Max", amountMinor: 270000 },
  ],
  SHOWTIME: [
    { planId: "show-youfit", label: "YouFit", amountMinor: 190000 },
    { planId: "show-solo", label: "Solo", amountMinor: 330000 },
  ],
};

export function listDisCos() {
  return DISCO_LIST;
}

export function listDataPlans() {
  return Object.entries(DATA_PLANS).map(([network, plans]) => ({
    network,
    plans: plans.map((p) => ({ ...p, amountNgn: `₦${(p.amountMinor / 100).toLocaleString()}` })),
  }));
}

export function listCablePackages() {
  return Object.entries(CABLE_PACKAGES).map(([provider, plans]) => ({
    provider,
    plans: plans.map((p) => ({ ...p, amountNgn: `₦${(p.amountMinor / 100).toLocaleString()}` })),
  }));
}

export function findDataPlan(network, planId) {
  return DATA_PLANS[network]?.find((p) => p.planId === planId) ?? null;
}

export function findCablePackage(provider, planId) {
  return CABLE_PACKAGES[provider]?.find((p) => p.planId === planId) ?? null;
}

// "Units token" — 20 digits, like a real prepaid meter token.
function electricityToken() {
  return Array.from({ length: 20 }, () => crypto.randomInt(0, 10)).join("");
}

export async function purchaseElectricity({ disCo, meterNo, meterType, amountMinor }) {
  return {
    disCo,
    meterNo,
    meterType,
    amountMinor,
    token: electricityToken(),
    reference: `MOCK-ELEC-${Date.now().toString(36).toUpperCase()}`,
    provider: "mock-bills",
    devOnly: true,
  };
}

export async function purchaseData({ network, planId, phone }) {
  return {
    network,
    planId,
    phone,
    reference: `MOCK-DATA-${Date.now().toString(36).toUpperCase()}`,
    provider: "mock-bills",
    devOnly: true,
  };
}

// Mock account lookup for a decoder.
export async function lookupCableAccount({ provider, decoderNo }) {
  return {
    provider,
    decoderNo,
    name: `SUBSCRIBER ${decoderNo.slice(0, 4)}`,
  };
}

export async function purchaseCable({ provider, decoderNo, planId }) {
  return {
    provider,
    decoderNo,
    planId,
    reference: `MOCK-CABLE-${Date.now().toString(36).toUpperCase()}`,
    provider: "mock-bills",
    devOnly: true,
  };
}