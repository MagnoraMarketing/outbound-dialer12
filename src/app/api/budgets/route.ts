import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";
import { periodBoundaries, workdaysThisMonth } from "@/lib/copenhagen-time";
import { DEFAULT_SYSTEM_FEE_DKK, splitEarnings, type SystemFeeSplit } from "@/lib/system-fee";
import { DEFAULT_AGREEMENT, WORKDAYS_PER_WEEK, resolveAgreement } from "@/lib/budget";

const NOT_ADMIN = "Kun administratorer kan ændre budgetter.";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const bounds = periodBoundaries();
  const workdays = workdaysThisMonth();
  const [targets, events, profiles, campaigns, team] = await Promise.all([
    context.supabase.from("sales_targets")
      .select("id, user_id, campaign_id, weekly_target, weekly_meeting_target, weekly_sale_target, commission_per_meeting, commission_per_sale, updated_at")
      .eq("team_id", context.profile.team_id),
    context.supabase.from("budget_events")
      .select("id, user_id, campaign_id, event_type, created_at")
      .eq("team_id", context.profile.team_id).gte("created_at", bounds.monthStart.toISOString())
      .lt("created_at", bounds.nextMonth.toISOString()),
    context.supabase.from("profiles").select("id, full_name, role")
      .eq("team_id", context.profile.team_id).order("full_name"),
    context.supabase.from("campaigns").select("id, name")
      .eq("team_id", context.profile.team_id).order("name"),
    context.supabase.from("teams").select("seller_system_fee_dkk")
      .eq("id", context.profile.team_id).maybeSingle(),
  ]);
  const failed = [targets, events, profiles, campaigns, team].find((query) => query.error);
  if (failed?.error) {
    console.error("Budget report query failed", failed.error.message);
    return apiError("Budgetoverblikket kunne ikke indlæses.", 500);
  }
  const seesTeam = context.profile.role === "admin" || context.profile.role === "manager";
  const members = (profiles.data ?? []).filter((member) => seesTeam || member.id === context.user.id);
  const activityRows = events.data ?? [];
  const feeDkk = Number(team.data?.seller_system_fee_dkk ?? DEFAULT_SYSTEM_FEE_DKK);
  const within = (createdAt: string, start: Date, end: Date) => {
    const time = new Date(createdAt).getTime();
    return time >= start.getTime() && time < end.getTime();
  };
  // An upsell (mersalg) is a sale to an existing customer and counts as a sale.
  const isSale = (eventType: string) => eventType === "sale" || eventType === "upsell";
  const systemFeeUsers: Record<string, SystemFeeSplit> = {};
  const people = members.map((member) => {
    const agreement = resolveAgreement(targets.data ?? [], member.id);
    const own = activityRows.filter((event) => event.user_id === member.id);
    const count = (start: Date, end: Date, sale: boolean) =>
      own.filter((event) => isSale(event.event_type) === sale && within(event.created_at, start, end)).length;
    const meetingsPerDay = agreement.weekly_meeting_target / WORKDAYS_PER_WEEK;
    const salesPerDay = agreement.weekly_sale_target / WORKDAYS_PER_WEEK;
    const monthlyMeetings = count(bounds.monthStart, bounds.nextMonth, false);
    const monthlySales = count(bounds.monthStart, bounds.nextMonth, true);
    const monthlyMeetingTarget = Math.round(meetingsPerDay * workdays);
    const monthlySaleTarget = Math.round(salesPerDay * workdays);
    const monthlyCommission = monthlyMeetings * agreement.commission_per_meeting + monthlySales * agreement.commission_per_sale;
    systemFeeUsers[member.id] = splitEarnings(monthlyCommission, feeDkk);
    return {
      user_id: member.id,
      user_name: member.full_name || "Uden navn",
      role: member.role,
      ...agreement,
      meetings_per_day: meetingsPerDay,
      monthly_meeting_target: monthlyMeetingTarget,
      monthly_sale_target: monthlySaleTarget,
      today_meetings: count(bounds.dayStart, bounds.nextDay, false),
      weekly_meetings: count(bounds.weekStart, bounds.nextWeek, false),
      monthly_meetings: monthlyMeetings,
      today_sales: count(bounds.dayStart, bounds.nextDay, true),
      weekly_sales: count(bounds.weekStart, bounds.nextWeek, true),
      monthly_sales: monthlySales,
      monthly_commission: monthlyCommission,
      expected_monthly_commission: monthlyMeetingTarget * agreement.commission_per_meeting
        + monthlySaleTarget * agreement.commission_per_sale,
    };
  });
  const visible = new Set(members.map((member) => member.id));
  return NextResponse.json({
    people,
    defaults: {
      meetings_per_day: DEFAULT_AGREEMENT.weekly_meeting_target / WORKDAYS_PER_WEEK,
      commission_per_meeting: DEFAULT_AGREEMENT.commission_per_meeting,
    },
    system_fee: { fee_dkk: feeDkk, users: systemFeeUsers },
    campaigns: campaigns.data ?? [],
    activities: activityRows
      .filter((event) => visible.has(event.user_id))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 100),
    period: {
      week_start: bounds.weekStart.toISOString(),
      month_start: bounds.monthStart.toISOString(),
      workdays,
    },
  });
}

// Administrators set each user's budget: meetings per day, commission per
// meeting and, optionally, weekly sales with their own commission.
export async function PUT(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const body = await readJson(request);
  if (!body || typeof body.user_id !== "string") return apiError("Vælg en bruger til budgettet.");
  const meetingsPerDay = Number(body.meetings_per_day);
  const commissionPerMeeting = Number(body.commission_per_meeting);
  const salesPerWeek = Number(body.sales_per_week ?? 0);
  const commissionPerSale = Number(body.commission_per_sale ?? 0);
  if (!Number.isFinite(meetingsPerDay) || meetingsPerDay < 0 || meetingsPerDay > 100
    || !Number.isFinite(commissionPerMeeting) || commissionPerMeeting < 0 || commissionPerMeeting > 1_000_000
    || !Number.isInteger(salesPerWeek) || salesPerWeek < 0 || salesPerWeek > 10000
    || !Number.isFinite(commissionPerSale) || commissionPerSale < 0 || commissionPerSale > 1_000_000) {
    return apiError("Kontrollér møder pr. dag, salg pr. uge og provisionssatserne.");
  }
  const { data: member, error: memberError } = await context.supabase.from("profiles")
    .select("id").eq("id", body.user_id).eq("team_id", context.profile.team_id).maybeSingle();
  if (memberError || !member) return apiError("Brugeren tilhører ikke dit team.", memberError ? 500 : 404);
  const found = await admin.from("sales_targets").select("id").eq("team_id", context.profile.team_id)
    .eq("user_id", body.user_id).is("campaign_id", null).maybeSingle();
  if (found.error) {
    console.error("Budget target lookup failed", found.error.message);
    return apiError("Budgettet kunne ikke findes.", 500);
  }
  const weeklyMeetings = Math.round(meetingsPerDay * WORKDAYS_PER_WEEK);
  const weeklyTotal = weeklyMeetings + salesPerWeek;
  const values = {
    activity_mode: salesPerWeek > 0 || commissionPerSale > 0 ? "both" : "meeting",
    weekly_meeting_target: weeklyMeetings,
    weekly_sale_target: salesPerWeek,
    commission_per_meeting: commissionPerMeeting,
    commission_per_sale: commissionPerSale,
    weekly_target: weeklyTotal,
    monthly_target: Math.round(weeklyTotal * 52 / 12),
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };
  const write = found.data
    ? await admin.from("sales_targets").update(values).eq("id", found.data.id).eq("team_id", context.profile.team_id).select("id").maybeSingle()
    : await admin.from("sales_targets").insert({ ...values, team_id: context.profile.team_id, user_id: body.user_id, campaign_id: null }).select("id").maybeSingle();
  if (write.error || !write.data) {
    console.error("Budget target save failed", write.error?.message ?? "No row returned");
    return apiError("Budgettet kunne ikke gemmes.", 500);
  }
  await writeAudit(context, "sales_target_updated", "sales_target", write.data.id, { user_id: body.user_id, ...values });
  return NextResponse.json({ success: true });
}

// Back to the standard budget: the user's saved budgets are removed.
export async function DELETE(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const userId = new URL(request.url).searchParams.get("user_id");
  if (!userId) return apiError("Vælg en bruger.");
  const { error } = await admin.from("sales_targets").delete()
    .eq("team_id", context.profile.team_id).eq("user_id", userId);
  if (error) {
    console.error("Budget reset failed", error.message);
    return apiError("Budgettet kunne ikke nulstilles.", 500);
  }
  await writeAudit(context, "sales_target_reset", "sales_target", userId, { user_id: userId });
  return NextResponse.json({ success: true });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const body = await readJson(request);
  if (!body || typeof body.campaign_id !== "string"
    || !["meeting", "sale", "upsell"].includes(String(body.event_type))) {
    return apiError("Vælg en kampagne og en gyldig aktivitet.");
  }
  const { data: campaign, error: campaignError } = await context.supabase.from("campaigns").select("id")
    .eq("id", body.campaign_id).eq("team_id", context.profile.team_id).maybeSingle();
  if (campaignError) {
    console.error("Budget event validation failed", campaignError.message);
    return apiError("Aktiviteten kunne ikke valideres.", 500);
  }
  if (!campaign) return apiError("Kampagnen blev ikke fundet.", 404);
  const { data, error } = await context.supabase.from("budget_events").insert({
    team_id: context.profile.team_id,
    user_id: context.user.id,
    campaign_id: body.campaign_id,
    event_type: body.event_type,
  }).select("id").single();
  if (error) {
    console.error("Budget event insert failed", error.message);
    return apiError("Aktiviteten kunne ikke registreres.", 500);
  }
  await writeAudit(context, "budget_event_recorded", "budget_event", data.id, {
    campaign_id: body.campaign_id, event_type: body.event_type,
  });
  return NextResponse.json({ success: true, id: data.id }, { status: 201 });
}
