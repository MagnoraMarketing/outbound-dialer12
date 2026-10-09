import type { createSupabaseAdminClient } from "@/lib/http";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export const FEEDBACK_STATUSES = ["good", "less_good", "not_qualified"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// A customer is reminded once a meeting is this old without a status.
export const FEEDBACK_REMINDER_MS = 12 * 60 * 60 * 1000;

export type MeetingFeedback = {
  status: FeedbackStatus;
  note: string;
  created_at: string;
  updated_at: string;
  seller_seen_at: string | null;
};

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function isFeedbackOverdue(meetingAt: string, hasFeedback: boolean, now = Date.now()) {
  return !hasFeedback && Date.parse(meetingAt) + FEEDBACK_REMINDER_MS <= now;
}

export async function feedbackByMeeting(admin: AdminClient, teamId: string, meetingIds: string[]) {
  const feedback = new Map<string, MeetingFeedback>();
  for (let offset = 0; offset < meetingIds.length; offset += 200) {
    const { data, error } = await admin.from("meeting_feedback")
      .select("meeting_id, status, note, created_at, updated_at, seller_seen_at")
      .eq("team_id", teamId)
      .in("meeting_id", meetingIds.slice(offset, offset + 200));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const { meeting_id: meetingId, ...rest } = row as MeetingFeedback & { meeting_id: string };
      feedback.set(meetingId, rest);
    }
  }
  return feedback;
}

// Campaigns whose partner has at least one login, i.e. meetings a partner is expected to rate.
export async function campaignsWithPartnerLogins(admin: AdminClient, teamId: string) {
  const { data: users, error } = await admin.from("partner_users").select("partner_id").eq("team_id", teamId);
  if (error) throw new Error(error.message);
  const partnerIds = [...new Set((users ?? []).map((row) => row.partner_id as string))];
  if (!partnerIds.length) return new Set<string>();
  const { data: campaigns, error: campaignError } = await admin.from("campaigns").select("id")
    .eq("team_id", teamId).in("partner_id", partnerIds);
  if (campaignError) throw new Error(campaignError.message);
  return new Set((campaigns ?? []).map((row) => row.id as string));
}
