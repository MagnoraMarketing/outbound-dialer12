import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { requirePartnerUser } from "@/lib/partner";
import { isFeedbackStatus } from "@/lib/meeting-feedback";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requirePartnerUser();
  if ("response" in result) return result.response;
  const { admin, account, campaigns } = result.context;
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const { id } = await params;
  const body = await readJson(request);
  if (!body || !isFeedbackStatus(body.status)) return apiError("Vælg en status for mødet.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  const { data: meeting, error } = await admin.from("meetings")
    .select("id, team_id, meeting_at, leads!inner(campaign_id)")
    .eq("id", id).eq("team_id", account.team_id).maybeSingle();
  if (error) {
    console.error("Customer feedback meeting lookup failed", error.message);
    return apiError("Mødet kunne ikke findes.", 500);
  }
  const lead = meeting?.leads as unknown as { campaign_id: string | null } | { campaign_id: string | null }[] | null;
  const campaignId = Array.isArray(lead) ? lead[0]?.campaign_id : lead?.campaign_id;
  if (!meeting || !campaignId || !campaignIds.includes(campaignId)) return apiError("Mødet findes ikke.", 404);
  if (Date.parse(meeting.meeting_at as string) > Date.now()) return apiError("Du kan give status, når mødet er afholdt.");

  const now = new Date().toISOString();
  const { data, error: saveError } = await admin.from("meeting_feedback").upsert({
    meeting_id: id,
    team_id: account.team_id,
    status: body.status,
    note,
    partner_user_id: account.user_id,
    updated_at: now,
    seller_seen_at: null,
  }, { onConflict: "meeting_id" }).select("status, note, updated_at").single();
  if (saveError) {
    console.error("Customer feedback save failed", saveError.message);
    return apiError("Status kunne ikke gemmes. Prøv igen.", 500);
  }
  return NextResponse.json({ data });
}
