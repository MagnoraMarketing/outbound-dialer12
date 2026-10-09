export type FeedbackStatus = "good" | "less_good" | "not_qualified";

export const feedbackLabels: Record<FeedbackStatus, string> = {
  good: "Godt møde",
  less_good: "Mindre godt møde",
  not_qualified: "Ikke kvalificeret",
};

export type MeetingState = FeedbackStatus | "overdue" | "awaiting" | "upcoming";

export const meetingStateLabels: Record<MeetingState, string> = {
  ...feedbackLabels,
  overdue: "Status mangler",
  awaiting: "Afventer status",
  upcoming: "Kommende",
};

export function meetingState(meeting: { meeting_at: string; overdue: boolean; feedback: { status: FeedbackStatus } | null }, now = Date.now()): MeetingState {
  if (meeting.feedback) return meeting.feedback.status;
  if (meeting.overdue) return "overdue";
  return Date.parse(meeting.meeting_at) <= now ? "awaiting" : "upcoming";
}

export function meetingTypeLabel(type: string) {
  return type === "in_person" ? "Fysisk møde" : type === "phone" ? "Telefonmøde" : "Onlinemøde";
}

// Calendar day key (YYYY-MM-DD) in Danish time, so meetings land on the right day.
export function copenhagenDayKey(value: string | Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(value));
}
