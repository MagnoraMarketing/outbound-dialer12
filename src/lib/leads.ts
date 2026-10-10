export const leadStatuses = [
  "new", "to_call", "called", "no_answer", "callback", "interested",
  "meeting_booked", "not_interested", "wrong_number", "do_not_call", "converted",
] as const;

export type LeadStatus = typeof leadStatuses[number];

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && leadStatuses.includes(value as LeadStatus);
}

function normalizeSinglePhone(value: string) {
  // Spreadsheet exports often turn numbers into "12345678.0".
  const trimmed = value.trim().replace(/\.0+$/, "");
  const normalized = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  if (!/^\+?[0-9\s().-]+$/.test(normalized)) return null;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (normalized.startsWith("+")) return `+${digits}`;
  if (digits.length === 8) return `+45${digits}`;
  if (digits.startsWith("45") && digits.length === 10) return `+${digits}`;
  return null;
}

export function normalizePhone(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^\s*(tlf|tel|telefon|mobil|phone)\.?:?\s*/i, "").replace(/\u00a0/g, " ");
  // A cell may hold several numbers ("12345678 / 87654321"); use the first valid one.
  for (const part of cleaned.split(/[,;/|]|\s+(?:og|or|eller)\s+/i)) {
    const phone = normalizeSinglePhone(part);
    if (phone) return phone;
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
