import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";

function copenhagenDayStart() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
  const midnightUtc = new Date(`${today}T00:00:00.000Z`);
  const offsetLabel = new Intl.DateTimeFormat("en", { timeZone: "Europe/Copenhagen", timeZoneName: "shortOffset" })
    .formatToParts(midnightUtc).find((part) => part.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "-" ? -1 : 1) : 0;
  return new Date(midnightUtc.getTime() - offsetMinutes * 60_000).toISOString();
}

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const start = copenhagenDayStart();
  const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  weekStart.setUTCHours(0, 0, 0, 0);
  let callQuery = context.supabase.from("calls")
    .select("id, user_id, status, outcome, duration_seconds", { count: "exact" })
    .gte("started_at", start);
  let leadQuery = context.supabase.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null)
    .in("status", ["new", "to_call", "called", "no_answer"]);
  let activityQuery = context.supabase.from("calls").select("started_at, status, outcome").gte("started_at", weekStart.toISOString());
  if (context.profile.role !== "admin") {
    callQuery = callQuery.eq("user_id", context.user.id);
    leadQuery = leadQuery.eq("assigned_user_id", context.user.id);
    activityQuery = activityQuery.eq("user_id", context.user.id);
  }
  const [callsResult, leadsResult, callbackResult, meetingResult, teamResult, activityResult] = await Promise.all([
    callQuery,
    leadQuery,
    context.supabase.from("callbacks").select("id", { count: "exact", head: true })
      .is("completed_at", null).lte("callback_at", new Date().toISOString()),
    context.supabase.from("meetings").select("id", { count: "exact", head: true }).gte("created_at", start),
    context.profile.role !== "admin"
      ? Promise.resolve({ data: null, error: null })
      : context.supabase.from("profiles").select("id, full_name").eq("team_id", context.profile.team_id),
    activityQuery,
  ]);
  const errors = [callsResult.error, leadsResult.error, callbackResult.error, meetingResult.error, teamResult.error, activityResult.error].filter(Boolean);
  if (errors.length) {
    errors.forEach((error) => error && console.error("Dashboard query failed", error.message));
    return apiError("Kunne ikke hente dashboard-data.", 500);
  }
  const calls = callsResult.data ?? [];
  const connected = calls.filter((call) => ["answered", "completed"].includes(call.status) && call.outcome !== "no_answer" && call.outcome !== "busy");
  const conversations = calls.filter((call) => ["interested", "not_interested", "meeting_booked", "callback"].includes(call.outcome ?? ""));
  const members = new Map((teamResult.data ?? []).map((profile) => [profile.id, profile.full_name || "Uden navn"]));
  const performance = context.profile.role !== "admin" ? [] : Array.from(members, ([userId, name]) => {
    const ownCalls = calls.filter((call) => call.user_id === userId);
    return {
      user_id: userId,
      name,
      calls: ownCalls.length,
      meetings: ownCalls.filter((call) => call.outcome === "meeting_booked").length,
      talk_time: ownCalls.reduce((sum, call) => sum + call.duration_seconds, 0),
    };
  });
  const talkTime = calls.reduce((sum, call) => sum + call.duration_seconds, 0);
  const activityDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart.getTime() + index * 24 * 60 * 60 * 1000);
    const key = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(day);
    const label = new Intl.DateTimeFormat("da-DK", { weekday: "short", timeZone: "Europe/Copenhagen" }).format(day);
    return {
      key,
      label: label.charAt(0).toLocaleUpperCase("da-DK") + label.slice(1, 3),
      calls: (activityResult.data ?? []).filter((call) =>
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(call.started_at)) === key,
      ).length,
      connected: (activityResult.data ?? []).filter((call) =>
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(call.started_at)) === key
        && ["answered", "completed"].includes(call.status) && !["no_answer", "busy"].includes(call.outcome ?? ""),
      ).length,
    };
  });
  return NextResponse.json({
    data: {
      calls: callsResult.count ?? 0,
      connected: connected.length,
      conversations: conversations.length,
      meetings: meetingResult.count ?? 0,
      conversion_rate: calls.length ? Math.round((calls.filter((call) => call.outcome === "meeting_booked").length / calls.length) * 100) : 0,
      talk_time: talkTime,
      leads_remaining: leadsResult.count ?? 0,
      callbacks: callbackResult.count ?? 0,
      performance,
      activity: activityDays,
    },
  });
}
