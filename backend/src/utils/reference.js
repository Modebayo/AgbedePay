// Human-unique reference generator for financial records.
// e.g. TXN-MCK21QD3A7Z9X, RVS-...
import { randomToken } from "./crypto.js";

export function generateReference(prefix = "TXN") {
  const time = Date.now().toString(36).toUpperCase().slice(-6);
  return `${prefix}-${time}${randomToken(3).toUpperCase()}`;
}