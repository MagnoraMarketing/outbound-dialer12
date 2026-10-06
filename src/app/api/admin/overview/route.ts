import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";

type CallRow = {
  id: string;
  user_id: string | null;
  status: string;
  outcome: string | null;
  duration_seconds: number;
  leads: { campaign_id: string | null }[] | null;
};

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer har adgang til den samlede statistik.", 403);

  const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [campaigns, profiles] = await Promise.all([
    context.supabase.from("campaigns").select("id, name")
      .eq("team_id", context.profile.team_id).order("name"),
    context.supabase.from("profiles").select("id", { count: "exact", head: true })
      .eq("team_id", context.profile.team_id),
  ]);
  const failed = [campaigns, profiles].find((query) => query.error);
  if (failed?.error) {
    console.error("Admin overview query failed", failed.error.message);
    return apiError("Administratoroverblikket kunne ikke indlæses.", 500);
  }

  const callRows: CallRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await context.supabase.from("calls")
      .select("id, user_id, status, outcome, duration_seconds, leads(campaign_id)")
      .eq("team_id", context.profile.team_id)
      .gte("started_at", periodStart)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) {
      console.error("Admin call statistics query failed", error.message);
      return apiError("Opkaldsstatistikken kunne ikke indlæses.", 500);
    }
    callRows.push(...((data ?? []) as CallRow[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  const summarize = (rows: CallRow[]) => ({
    calls: rows.length,
    connected: rows.filter((call) => ["answered", "completed"].includes(call.status)
      && !["no_answer", "busy"].includes(call.outcome ?? "")).length,
    meetings: rows.filter((call) => call.outcome === "meeting_booked").length,
    talk_time: rows.reduce((total, call) => total + call.duration_seconds, 0),
  });
  const byCampaign = new Map<string, CallRow[]>();
  for (const call of callRows) {
    const campaignId = call.leads?.[0]?.campaign_id;
    if (campaignId) byCampaign.set(campaignId, [...(byCampaign.get(campaignId) ?? []), call]);
  }
  return NextResponse.json({
    data: {
      period_start: periodStart,
      totals: { ...summarize(callRows), users: profiles.count ?? 0 },
      campaigns: (campaigns.data ?? []).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        ...summarize(byCampaign.get(campaign.id) ?? []),
      })),
    },
  });
}
