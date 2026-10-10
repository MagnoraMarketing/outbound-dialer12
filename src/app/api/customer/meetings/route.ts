import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { requirePartnerUser } from "@/lib/partner";
import { feedbackByMeeting, isFeedbackOverdue } from "@/lib/meeting-feedback";
import { siteUrl } from "@/lib/site-url";

type MeetingRow = {
  id: string; meeting_at: string; meeting_type: string; notes: string; calendar_url: string | null; user_id: string;
  leads: { company_name: string; contact_person: string | null; phone: string; email: string | null; campaign_id: string | null } | null;
};

export async function GET() {
  const result = await requirePartnerUser();
  if ("response" in result) return result.response;
  const { admin, account, partnerName, campaigns } = result.context;
  const customer = { full_name: account.full_name, company_name: partnerName, email: account.email };
  if (!campaigns.length) return NextResponse.json({ customer, campaigns: [], data: [] });
  // Each campaign has its own calendar feed the customer can subscribe to.
  const feeds = await admin.from("campaigns").select("id, calendar_token")
    .in("id", campaigns.map((campaign) => campaign.id));
  const tokenByCampaign = new Map((feeds.error ? [] : feeds.data ?? [])
    .map((row) => [row.id as string, row.calendar_token as string]));
  const campaignList = campaigns.map((campaign) => ({
    id: campaign.id, name: campaign.name,
    feed_url: tokenByCampaign.has(campaign.id) ? `${siteUrl()}/api/calendar/${tokenByCampaign.get(campaign.id)}.ics` : null,
  }));

  const meetings = await admin.from("meetings")
    .select("id, meeting_at, meeting_type, notes, calendar_url, user_id, leads!inner(company_name, contact_person, phone, email, campaign_id)")
    .eq("team_id", account.team_id)
    .in("leads.campaign_id", campaigns.map((campaign) => campaign.id))
    .order("meeting_at", { ascending: true })
    .limit(1000);
  if (meetings.error) {
    console.error("Partner meetings query failed", meetings.error.message);
    return apiError("Møderne kunne ikke hentes.", 500);
  }
  const rows = (meetings.data ?? []) as unknown as MeetingRow[];
  const sellerIds = [...new Set(rows.map((row) => row.user_id))];
  const [sellers, feedback] = await Promise.all([
    sellerIds.length
      ? admin.from("profiles").select("id, full_name").in("id", sellerIds)
      : Promise.resolve({ data: [], error: null }),
    feedbackByMeeting(admin, account.team_id, rows.map((row) => row.id)).catch((error: Error) => error),
  ]);
  if (sellers.error || feedback instanceof Error) {
    console.error("Partner meeting details failed", sellers.error?.message ?? (feedback as Error).message);
    return apiError("Møderne kunne ikke hentes.", 500);
  }
  const sellerNames = new Map((sellers.data ?? []).map((seller) => [seller.id as string, (seller.full_name as string) || "Sælger"]));
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const now = Date.now();
  return NextResponse.json({
    customer,
    campaigns: campaignList,
    data: rows.map((row) => {
      const rowFeedback = feedback.get(row.id) ?? null;
      return {
        id: row.id,
        meeting_at: row.meeting_at,
        meeting_type: row.meeting_type,
        notes: row.notes,
        calendar_url: row.calendar_url,
        seller_name: sellerNames.get(row.user_id) ?? "Sælger",
        campaign_id: row.leads?.campaign_id ?? null,
        campaign_name: campaignNames.get(row.leads?.campaign_id ?? "") ?? "",
        company_name: row.leads?.company_name ?? "Virksomhed",
        contact_person: row.leads?.contact_person ?? null,
        phone: row.leads?.phone ?? null,
        email: row.leads?.email ?? null,
        feedback: rowFeedback && { status: rowFeedback.status, note: rowFeedback.note, updated_at: rowFeedback.updated_at },
        overdue: isFeedbackOverdue(row.meeting_at, Boolean(rowFeedback), now),
      };
    }),
  });
}
