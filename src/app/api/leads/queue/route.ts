import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";
import { normalizePhone } from "@/lib/leads";

export async function GET(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const params = new URL(request.url).searchParams;
  const campaignId = params.get("campaign_id");
  const listId = params.get("lead_list_id");
  if (!campaignId) return NextResponse.json({ data: [] });
  const { data: campaign, error: campaignError } = await context.supabase.from("campaigns")
    .select("id").eq("id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
  if (campaignError || !campaign) return apiError("Kampagnen blev ikke fundet eller er ikke tildelt dig.", campaignError ? 500 : 404);
  if (listId) {
    const { data: leadList, error: listError } = await context.supabase.from("lead_lists")
      .select("id").eq("id", listId).eq("campaign_id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
    if (listError || !leadList) return apiError("Leadlisten blev ikke fundet i den valgte kampagne.", listError ? 500 : 404);
  }
  const now = new Date().toISOString();
  let query = context.supabase.from("leads").select("*")
    .is("deleted_at", null)
    .eq("campaign_id", campaignId)
    .not("status", "in", '("do_not_call","wrong_number","converted")')
    .or(`next_follow_up_at.is.null,next_follow_up_at.lte.${now}`);
  if (listId) query = query.eq("lead_list_id", listId);
  const { data, error } = await query
    .order("next_follow_up_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("Lead queue query failed", error.code, error.message);
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code)) {
      return apiError(
        "Opkaldskøen er ikke klar endnu. Kontakt din administrator.",
        503,
      );
    }
    return apiError("Kunne ikke hente opkaldskøen.", 500);
  }
  const candidates = (data ?? []).filter((lead) => normalizePhone(lead.phone));
  // When nothing is ready, say why, so an empty queue is never a mystery.
  async function explainEmpty(activeCalls = 0) {
    const count = (build: (query: ReturnType<typeof base>) => ReturnType<typeof base>) => build(base()).then((result) => result.count ?? 0);
    function base() {
      let query = context.supabase.from("leads").select("id", { count: "exact", head: true })
        .is("deleted_at", null).eq("campaign_id", campaignId!);
      if (listId) query = query.eq("lead_list_id", listId);
      return query;
    }
    const [total, closed, waiting] = await Promise.all([
      count((query) => query),
      count((query) => query.in("status", ["do_not_call", "wrong_number", "converted"])),
      count((query) => query.not("status", "in", '("do_not_call","wrong_number","converted")').gt("next_follow_up_at", now)),
    ]);
    return NextResponse.json({ data: [], stats: {
      total, closed, waiting, invalid_phone: (data ?? []).length - candidates.length, active_calls: activeCalls,
    } });
  }
  if (!candidates.length) return explainEmpty();
  // Look up the team's few live calls instead of passing every lead id: 500 ids
  // make the request URL too long and the whole queue came back empty.
  const { data: activeCalls, error: activeError } = await context.supabase.from("calls")
    .select("lead_id").eq("team_id", context.profile.team_id).not("lead_id", "is", null)
    .in("status", ["queued", "initiated", "ringing", "answered"])
    .gte("started_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
  if (activeError) {
    console.error("Active call lookup failed", activeError.message);
    return apiError("Kunne ikke kontrollere aktive opkald.", 500);
  }
  const active = new Set((activeCalls ?? []).map((call) => call.lead_id));
  const queue = candidates.filter((lead) => !active.has(lead.id)).sort((left, right) => {
    const callbackPriority = Number(Boolean(left.next_follow_up_at)) - Number(Boolean(right.next_follow_up_at));
    if (callbackPriority) return -callbackPriority;
    const assignmentPriority = Number(left.assigned_user_id === context.user.id)
      - Number(right.assigned_user_id === context.user.id);
    if (assignmentPriority) return -assignmentPriority;
    const freshPriority = Number(["new", "to_call"].includes(left.status))
      - Number(["new", "to_call"].includes(right.status));
    if (freshPriority) return -freshPriority;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
  if (!queue.length) return explainEmpty(active.size);
  return NextResponse.json({ data: queue });
}
