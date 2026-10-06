import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const { data, error } = await context.supabase.from("calls")
    .select("*, leads(company_name, contact_person)")
    .order("started_at", { ascending: false }).limit(100);
  if (error) {
    console.error("Call history query failed", error.message);
    return apiError("Kunne ikke hente opkaldshistorik.", 500);
  }
  const calls = (data ?? []).map((call) => ({
    ...call,
    recording_url: result.context.profile.role === "admin" && call.recording_url
      ? `/api/calls/${call.id}/recording`
      : null,
  }));
  return NextResponse.json({ data: calls });
}
