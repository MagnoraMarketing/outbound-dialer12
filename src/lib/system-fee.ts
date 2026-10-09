export const DEFAULT_SYSTEM_FEE_DKK = 500;

export type SystemFeeSplit = { gross: number; covered: number; own: number };

// The first `fee` kroner a seller earns in a month cover the system; the rest is the seller's own.
export function splitEarnings(gross: number, fee: number): SystemFeeSplit {
  const total = Math.max(0, Number.isFinite(gross) ? gross : 0);
  const cap = Math.max(0, Number.isFinite(fee) ? fee : DEFAULT_SYSTEM_FEE_DKK);
  const covered = Math.min(total, cap);
  return { gross: total, covered, own: total - covered };
}
