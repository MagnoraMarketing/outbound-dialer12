import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const { data, error } = await context.supabase.from("team_messages")
    .select("id, broadcast_id, recipient_user_id, sent_by, campaign_id, lead_list_id, title, body, created_at, read_at")
    .eq("team_id", context.profile.team_id).order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error("Team messages query failed", error.message);
    return apiError("Beskeder kunne ikke hentes.", 500);
  }
  if (context.profile.role !== "admin") return NextResponse.json({ data });
  const grouped = new Map<string, (typeof data)[number] & { recipient_count: number }>();
  for (const message of data ?? []) {
    const existing = grouped.get(message.broadcast_id);
    if (existing) existing.recipient_count += 1;
    else grouped.set(message.broadcast_id, { ...message, recipient_count: 1 });
  }
  return NextResponse.json({ data: [...grouped.values()] });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan sende beskeder.", 403);
  const body = await readJson(request);
  if (!body) return apiError("Beskeddata mangler.");
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const message = typeof body?.body === "string" ? body.body.trim() : "";
  const scope = body?.scope;
  if (title.length < 2 || title.length > 120 || !message || message.length > 2000) {
    return apiError("Overskriften skal være 2–120 tegn, og beskeden 1–2.000 tegn.");
  }
  if (!["team", "campaign", "lead_list"].includes(String(scope))) return apiError("Vælg hvem beskeden skal sendes til.");
  let campaignId: string | null = null;
  let leadListId: string | null = null;
  let recipientIds: string[] = [];
  if (scope === "team") {
    const { data, error } = await context.supabase.from("profiles").select("id").eq("team_id", context.profile.team_id);
    if (error) return apiError("Teamets brugere kunne ikke hentes.", 500);
    recipientIds = (data ?? []).map((profile) => profile.id).filter((id) => id !== context.user.id);
  } else if (scope === "campaign") {
    if (typeof body.campaign_id !== "string") return apiError("Vælg en kampagne.");
    campaignId = body.campaign_id;
    const { data: campaign, error: campaignError } = await context.supabase.from("campaigns").select("id")
      .eq("id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
    if (campaignError || !campaign) return apiError("Kampagnen blev ikke fundet.", campaignError ? 500 : 404);
    const { data, error } = await context.supabase.from("campaign_assignments").select("user_id")
      .eq("team_id", context.profile.team_id).eq("campaign_id", campaignId);
    if (error) return apiError("Kampagnens brugere kunne ikke hentes.", 500);
    recipientIds = (data ?? []).map((assignment) => assignment.user_id);
  } else {
    if (typeof body.lead_list_id !== "string") return apiError("Vælg en leadliste.");
    leadListId = body.lead_list_id;
    const { data: leadList, error: listError } = await context.supabase.from("lead_lists")
      .select("id, campaign_id").eq("id", leadListId).eq("team_id", context.profile.team_id).maybeSingle();
    if (listError || !leadList) return apiError("Leadlisten blev ikke fundet.", listError ? 500 : 404);
    campaignId = leadList.campaign_id;
    const { data, error } = await context.supabase.from("lead_list_assignments").select("user_id")
      .eq("team_id", context.profile.team_id).eq("lead_list_id", leadListId);
    if (error) return apiError("Listens brugere kunne ikke hentes.", 500);
    recipientIds = (data ?? []).map((assignment) => assignment.user_id);
  }
  recipientIds = [...new Set(recipientIds)].filter((id) => id !== context.user.id);
  if (!recipientIds.length) return apiError("Der er ingen andre teammedlemmer tildelt denne målgruppe.", 409);
  const broadcastId = crypto.randomUUID();
  const rows = recipientIds.map((recipient_user_id) => ({
    broadcast_id: broadcastId,
    team_id: context.profile.team_id,
    recipient_user_id,
    sent_by: context.user.id,
    campaign_id: campaignId,
    lead_list_id: leadListId,
    title,
    body: message,
  }));
  const { data, error } = await context.supabase.from("team_messages").insert(rows).select("id");
  if (error) {
    console.error("Team message send failed", error.message);
    return apiError("Beskeden kunne ikke sendes.", 500);
  }
  await writeAudit(context, "team_message_sent", "team_message", null, {
    scope, campaign_id: campaignId, lead_list_id: leadListId, recipients: recipientIds.length,
  });
  return NextResponse.json({ sent: data.length }, { status: 201 });
}
