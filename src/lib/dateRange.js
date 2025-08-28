// src/lib/dateRange.js
// Builds an inclusive month window [from, to) using UTC ISO strings.
// Example: monthRange("2025-01", "2025-08")
//  -> { gte: "2025-01-01T00:00:00.000Z", lt: "2025-09-01T00:00:00.000Z" }
export function monthRange(fromYYYYMM, toYYYYMM) {
  if (!fromYYYYMM || !toYYYYMM) throw new Error("monthRange requires 'YYYY-MM' inputs");
  const [fyStr, fmStr] = String(fromYYYYMM).split("-");
  const [tyStr, tmStr] = String(toYYYYMM).split("-");
  const fy = Number(fyStr);
  const fm = Number(fmStr);
  const ty = Number(tyStr);
  const tm = Number(tmStr);
  if (!fy || !fm || !ty || !tm) throw new Error("Invalid YYYY-MM inputs");

  const from = new Date(Date.UTC(fy, fm - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(ty, tm, 1, 0, 0, 0)); // first day of month AFTER "to"
  return { gte: from.toISOString(), lt: to.toISOString() };
}
