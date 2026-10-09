import type { createSupabaseAdminClient } from "@/lib/http";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type ProviderNumber = { id: string; phone_number: string; status: string; connection_id: string | null; connection_name: string | null };

export function normalizeCallerNumber(raw: unknown) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}

// Caller number for a call: the campaign's number, else the team default, else
// the legacy TELNYX_PHONE_NUMBER environment variable. Null when none is set up.
export async function resolveCallerNumber(admin: AdminClient, teamId: string, campaignId: string | null) {
  if (campaignId) {
    const { data, error } = await admin.from("campaigns")
      .select("phone_numbers(number)").eq("id", campaignId).eq("team_id", teamId).maybeSingle();
    if (error) throw new Error(error.message);
    const linked = data?.phone_numbers as unknown as { number: string } | { number: string }[] | null;
    const number = Array.isArray(linked) ? linked[0]?.number : linked?.number;
    if (number) return number;
  }
  const { data: fallback, error } = await admin.from("phone_numbers")
    .select("number").eq("team_id", teamId).eq("is_default", true).maybeSingle();
  if (error) throw new Error(error.message);
  return fallback?.number ?? normalizeCallerNumber(process.env.TELNYX_PHONE_NUMBER);
}

// Active numbers on the telephony account, for the admin number picker.
export async function listProviderNumbers(): Promise<ProviderNumber[]> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error("TELNYX_API_KEY mangler på serveren.");
  const numbers: ProviderNumber[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`https://api.telnyx.com/v2/phone_numbers?page[number]=${page}&page[size]=250`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as {
      data?: { id?: string; phone_number?: string; status?: string; connection_id?: string | null; connection_name?: string | null }[];
      meta?: { total_pages?: number };
    } | null;
    if (!response.ok) {
      console.error("Phone number list request failed", response.status, payload);
      throw new Error(`Telnyx kunne ikke liste numre (HTTP ${response.status}). Kontrollér API-nøglens rettigheder.`);
    }
    for (const row of payload?.data ?? []) {
      if (row.id && row.phone_number) {
        numbers.push({ id: row.id, phone_number: row.phone_number, status: row.status ?? "", connection_id: row.connection_id ?? null, connection_name: row.connection_name ?? null });
      }
    }
    if (!payload?.meta?.total_pages || page >= payload.meta.total_pages) break;
  }
  return numbers;
}
