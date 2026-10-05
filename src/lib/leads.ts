export const leadStatuses = [
  "new", "to_call", "called", "no_answer", "callback", "interested",
  "meeting_booked", "not_interested", "wrong_number", "do_not_call", "converted",
] as const;

export type LeadStatus = typeof leadStatuses[number];

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && leadStatuses.includes(value as LeadStatus);
}

export function normalizePhone(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  if (!/^\+?[0-9\s().-]+$/.test(normalized)) return null;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (normalized.startsWith("+")) return `+${digits}`;
  if (digits.length === 8) return `+45${digits}`;
  if (digits.startsWith("45") && digits.length === 10) return `+${digits}`;
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
