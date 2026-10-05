import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";

type MeetingRow = { user_id: string; created_at: string; leads: { campaign_id: string | null }[] | null };

function copenhagenToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function copenhagenMidnightUtc(date: string) {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  const offsetLabel = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Copenhagen", timeZoneName: "shortOffset",
  }).formatToParts(midnight).find((part) => part.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = match
    ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "-" ? -1 : 1)
    : 0;
  return new Date(midnight.getTime() - offset * 60_000);
}

function periodBoundaries() {
  const today = copenhagenToday();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const monday = new Date(todayDate);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    weekStart: copenhagenMidnightUtc(dateKey(monday)),
    nextWeek: copenhagenMidnightUtc(dateKey(new Date(monday.getTime() + 7 * 86400_000))),
    monthStart: copenhagenMidnightUtc(monthStart),
    nextMonth: copenhagenMidnightUtc(dateKey(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1)))),
  };
}

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const bounds = periodBoundaries();
  const [targets, meetings, profiles, campaigns] = await Promise.all([
    context.supabase.from("sales_targets")
      .select("id, user_id, campaign_id, weekly_target, monthly_target, updated_at")
      .eq("team_id", context.profile.team_id),
    context.supabase.from("meetings")
      .select("user_id, created_at, leads(campaign_id)")
      .eq("team_id", context.profile.team_id).gte("created_at", bounds.monthStart.toISOString())
      .lt("created_at", bounds.nextMonth.toISOString()),
    context.supabase.from("profiles").select("id, full_name, role")
      .eq("team_id", context.profile.team_id).order("full_name"),
    context.supabase.from("campaigns").select("id, name")
      .eq("team_id", context.profile.team_id).order("name"),
  ]);
  const failed = [targets, meetings, profiles, campaigns].find((query) => query.error);
  if (failed?.error) {
    console.error("Budget report query failed", failed.error.message);
    return apiError("Budgetoverblikket kunne ikke indlæses.", 500);
  }
  const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const campaignById = new Map((campaigns.data ?? []).map((campaign) => [campaign.id, campaign]));
  const meetingRows = (meetings.data ?? []) as MeetingRow[];
  const data = (targets.data ?? []).map((target) => {
    const ownMeetings = meetingRows.filter((meeting) => {
      if (meeting.user_id !== target.user_id) return false;
      return target.campaign_id === null || meeting.leads?.some((lead) => lead.campaign_id === target.campaign_id);
    });
    const weeklyMeetings = ownMeetings.filter((meeting) => {
      const time = new Date(meeting.created_at).getTime();
      return time >= bounds.weekStart.getTime() && time < bounds.nextWeek.getTime();
    }).length;
    return {
      ...target,
      user_name: profileById.get(target.user_id)?.full_name || "Uden navn",
      role: profileById.get(target.user_id)?.role ?? "salesperson",
      campaign_name: target.campaign_id ? campaignById.get(target.campaign_id)?.name ?? "Kampagne" : null,
      weekly_meetings: weeklyMeetings,
      monthly_meetings: ownMeetings.length,
    };
  });
  return NextResponse.json({
    data,
    members: profiles.data ?? [],
    campaigns: campaigns.data ?? [],
    period: {
      week_start: bounds.weekStart.toISOString(),
      week_end: bounds.nextWeek.toISOString(),
      month_start: bounds.monthStart.toISOString(),
      month_end: bounds.nextMonth.toISOString(),
    },
  });
}

export async function PUT(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const body = await readJson(request);
  if (!body || typeof body.user_id !== "string") return apiError("Vælg en bruger til budgettet.");
  const campaignId = body.campaign_id === null ? null
    : typeof body.campaign_id === "string" ? body.campaign_id : undefined;
  if (campaignId === undefined) return apiError("Vælg en gyldig kampagne eller samlet budget.");
  const weeklyTarget = body.weekly_target;
  const monthlyTarget = body.monthly_target;
  if (!Number.isInteger(weeklyTarget) || Number(weeklyTarget) < 0 || Number(weeklyTarget) > 10000
    || !Number.isInteger(monthlyTarget) || Number(monthlyTarget) < 0 || Number(monthlyTarget) > 50000) {
    return apiError("Ugentligt mål skal være 0–10.000 møder, og månedligt mål 0–50.000.");
  }
  if (context.profile.role !== "admin" && body.user_id !== context.user.id) {
    return apiError("Du kan kun ændre dit eget budget.", 403);
  }
  const { data: member, error: memberError } = await context.supabase.from("profiles")
    .select("id").eq("id", body.user_id).eq("team_id", context.profile.team_id).maybeSingle();
  if (memberError || !member) return apiError("Brugeren tilhører ikke dit team.", memberError ? 500 : 404);
  if (campaignId) {
    const { data: campaign, error: campaignError } = await context.supabase.from("campaigns")
      .select("id").eq("id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
    if (campaignError || !campaign) return apiError("Kampagnen blev ikke fundet i dit team.", campaignError ? 500 : 404);
    if (context.profile.role !== "admin") {
      const { data: assignment, error: assignmentError } = await context.supabase.from("campaign_assignments")
        .select("campaign_id").eq("team_id", context.profile.team_id)
        .eq("campaign_id", campaignId).eq("user_id", context.user.id).maybeSingle();
      if (assignmentError || !assignment) return apiError("Du kan kun sætte budget for en tildelt kampagne.", assignmentError ? 500 : 403);
    }
  }
  const targetQuery = campaignId
    ? context.supabase.from("sales_targets").select("id").eq("team_id", context.profile.team_id)
      .eq("user_id", body.user_id).eq("campaign_id", campaignId).maybeSingle()
    : context.supabase.from("sales_targets").select("id").eq("team_id", context.profile.team_id)
      .eq("user_id", body.user_id).is("campaign_id", null).maybeSingle();
  const found = await targetQuery;
  if (found.error) {
    console.error("Budget target lookup failed", found.error.message);
    return apiError("Budgetmålet kunne ikke findes.", 500);
  }
  const existingId = found.data?.id;
  const values = {
    team_id: context.profile.team_id,
    user_id: body.user_id,
    campaign_id: campaignId,
    weekly_target: Number(weeklyTarget),
    monthly_target: Number(monthlyTarget),
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };
  const write = existingId
    ? await context.supabase.from("sales_targets").update(values).eq("id", existingId).select("id").maybeSingle()
    : await context.supabase.from("sales_targets").insert(values).select("id").maybeSingle();
  if (write.error || !write.data) {
    console.error("Budget target save failed", write.error?.message ?? "No row returned");
    return apiError("Budgetmålet kunne ikke gemmes.", 500);
  }
  await writeAudit(context, "sales_target_updated", "sales_target", write.data.id, {
    user_id: body.user_id, campaign_id: campaignId, weekly_target: Number(weeklyTarget), monthly_target: Number(monthlyTarget),
  });
  return NextResponse.json({ success: true });
}
