// Money helpers. Rule: financial amounts are INTEGER minor units (kobo).
// Never use floats for money — see docs/database.md §6.

// Minor units (kobo) -> display string: 20500000 -> "205000.00"
export function minorToNaira(minor) {
  return (minor / 100).toFixed(2);
}

// Minor units -> Nigerian-format currency string: "₦205,000.00"
export function formatNaira(minor) {
  return (minor / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });
}

// "5000" -> 500000 kobo (whole naira to minor units)
export function nairaToMinor(naira) {
  const whole = Math.round(naira * 100);
  return whole;
}