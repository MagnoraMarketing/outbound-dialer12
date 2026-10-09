import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";
import { campaignsWithPartnerLogins, feedbackByMeeting, isFeedbackOverdue } from "@/lib/meeting-feedback";

type MeetingRow = {
  id: string; meeting_at: string; meeting_type: string; user_id: string;
  leads: { company_name: string; contact_person: string | null; campaign_id: string | null } | null;
};

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer har adgang til mødefeedback.", 403);
  const teamId = context.profile.team_id;
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [meetings, profiles, campaigns, partnerCampaigns] = await Promise.all([
      admin.from("meetings").select("id, meeting_at, meeting_type, user_id, leads(company_name, contact_person, campaign_id)")
        .eq("team_id", teamId).gte("meeting_at", since).order("meeting_at", { ascending: false }).limit(2000),
      admin.from("profiles").select("id, full_name").eq("team_id", teamId),
      admin.from("campaigns").select("id, name").eq("team_id", teamId),
      campaignsWithPartnerLogins(admin, teamId),
    ]);
    const failed = [meetings, profiles, campaigns].find((query) => query.error);
    if (failed?.error) throw new Error(failed.error.message);
    const rows = (meetings.data ?? []) as unknown as MeetingRow[];
    const feedback = await feedbackByMeeting(admin, teamId, rows.map((row) => row.id));
    const sellerNames = new Map((profiles.data ?? []).map((profile) => [profile.id as string, (profile.full_name as string) || "Uden navn"]));
    const campaignNames = new Map((campaigns.data ?? []).map((campaign) => [campaign.id as string, campaign.name as string]));
    const now = Date.now();
    const data = rows.map((row) => {
      const campaignId = row.leads?.campaign_id ?? null;
      const rowFeedback = feedback.get(row.id) ?? null;
      const hasPartner = Boolean(campaignId && partnerCampaigns.has(campaignId));
      return {
        id: row.id,
        meeting_at: row.meeting_at,
        meeting_type: row.meeting_type,
        seller_id: row.user_id,
        seller_name: sellerNames.get(row.user_id) ?? "Uden navn",
        campaign_id: campaignId,
        campaign_name: campaignId ? campaignNames.get(campaignId) ?? "" : "",
        company_name: row.leads?.company_name ?? "Virksomhed",
        contact_person: row.leads?.contact_person ?? null,
        has_customer: hasPartner,
        feedback: rowFeedback && { status: rowFeedback.status, note: rowFeedback.note, updated_at: rowFeedback.updated_at },
        overdue: hasPartner && isFeedbackOverdue(row.meeting_at, Boolean(rowFeedback), now),
      };
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Admin meeting feedback query failed", error);
    return apiError("Mødefeedback kunne ikke hentes.", 500);
  }
}
