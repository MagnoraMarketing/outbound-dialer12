import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";
import { periodBoundaries } from "@/lib/copenhagen-time";
import { DEFAULT_SYSTEM_FEE_DKK, splitEarnings, type SystemFeeSplit } from "@/lib/system-fee";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const bounds = periodBoundaries();
  const [targets, meetings, profiles, campaigns, team] = await Promise.all([
    context.supabase.from("sales_targets")
      .select("id, user_id, campaign_id, weekly_target, monthly_target, weekly_meeting_target, weekly_sale_target, activity_mode, commission_per_meeting, commission_per_sale, updated_at")
      .eq("team_id", context.profile.team_id),
    context.supabase.from("budget_events")
      .select("user_id, campaign_id, event_type, created_at")
      .eq("team_id", context.profile.team_id).gte("created_at", bounds.monthStart.toISOString())
      .lt("created_at", bounds.nextMonth.toISOString()),
    context.supabase.from("profiles").select("id, full_name, role")
      .eq("team_id", context.profile.team_id).order("full_name"),
    context.supabase.from("campaigns").select("id, name")
      .eq("team_id", context.profile.team_id).order("name"),
    context.supabase.from("teams").select("seller_system_fee_dkk")
      .eq("id", context.profile.team_id).maybeSingle(),
  ]);
  const failed = [targets, meetings, profiles, campaigns, team].find((query) => query.error);
  if (failed?.error) {
    console.error("Budget report query failed", failed.error.message);
    return apiError("Budgetoverblikket kunne ikke indlæses.", 500);
  }
  const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const campaignById = new Map((campaigns.data ?? []).map((campaign) => [campaign.id, campaign]));
  const activityRows = meetings.data ?? [];
  const data = (targets.data ?? []).map((target) => {
    const events = activityRows.filter((event) =>
      event.user_id === target.user_id
      && (target.campaign_id === null || event.campaign_id === target.campaign_id),
    );
    const weeklyEvents = events.filter((event) => {
      const time = new Date(event.created_at).getTime();
      return time >= bounds.weekStart.getTime() && time < bounds.nextWeek.getTime();
    });
    const weeklyMeetings = weeklyEvents.filter((event) => event.event_type === "meeting").length;
    // An upsell (mersalg) is a sale to an existing customer and counts as a sale.
    const isSale = (event: { event_type: string }) => event.event_type === "sale" || event.event_type === "upsell";
    const weeklySales = weeklyEvents.filter(isSale).length;
    const monthlyMeetings = events.filter((event) => event.event_type === "meeting").length;
    const monthlySales = events.filter(isSale).length;
    const weeklyMeetingTarget = target.weekly_meeting_target || 0;
    const weeklySaleTarget = target.weekly_sale_target || 0;
    const monthlyExpectedCommission = (weeklyMeetingTarget * Number(target.commission_per_meeting)
      + weeklySaleTarget * Number(target.commission_per_sale)) * (52 / 12);
    return {
      ...target,
      user_name: profileById.get(target.user_id)?.full_name || "Uden navn",
      role: profileById.get(target.user_id)?.role ?? "salesperson",
      campaign_name: target.campaign_id ? campaignById.get(target.campaign_id)?.name ?? "Kampagne" : null,
      weekly_meetings: weeklyMeetings,
      monthly_meetings: monthlyMeetings,
      weekly_sales: weeklySales,
      monthly_sales: monthlySales,
      monthly_commission: monthlyMeetings * Number(target.commission_per_meeting)
        + monthlySales * Number(target.commission_per_sale),
      expected_monthly_commission: monthlyExpectedCommission,
    };
  });
  // Monthly system coverage per seller: the first part of the month's commission covers the system.
  const feeDkk = Number(team.data?.seller_system_fee_dkk ?? DEFAULT_SYSTEM_FEE_DKK);
  const grossByUser = new Map<string, number>();
  for (const row of data) grossByUser.set(row.user_id, (grossByUser.get(row.user_id) ?? 0) + row.monthly_commission);
  const systemFeeUsers: Record<string, SystemFeeSplit> = {};
  for (const [userId, gross] of grossByUser) systemFeeUsers[userId] = splitEarnings(gross, feeDkk);
  return NextResponse.json({
    data,
    system_fee: { fee_dkk: feeDkk, users: systemFeeUsers },
    members: profiles.data ?? [],
    campaigns: campaigns.data ?? [],
    activities: activityRows
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 100),
    period: {
      week_start: bounds.weekStart.toISOString(),
      week_end: bounds.nextWeek.toISOString(),
      month_start: bounds.monthStart.toISOString(),
      month_end: bounds.nextMonth.toISOString(),
    },
  });
}

// Owner and campaign never change on update, and sellers may not write them.
function updatable(values: Record<string, unknown>) {
  const { team_id: _team, user_id: _user, campaign_id: _campaign, ...rest } = values;
  return rest;
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
  const hasActivitySettings = body.activity_mode !== undefined
    || body.weekly_meeting_target !== undefined
    || body.weekly_sale_target !== undefined
    || body.commission_per_meeting !== undefined
    || body.commission_per_sale !== undefined;
  const activityMode = body.activity_mode;
  const weeklyMeetingTarget = body.weekly_meeting_target ?? 0;
  const weeklySaleTarget = body.weekly_sale_target ?? 0;
  const commissionPerMeeting = body.commission_per_meeting ?? 0;
  const commissionPerSale = body.commission_per_sale ?? 0;
  if (hasActivitySettings) {
    if (!["meeting", "sale", "both"].includes(String(activityMode))
      || !Number.isInteger(weeklyMeetingTarget) || Number(weeklyMeetingTarget) < 0 || Number(weeklyMeetingTarget) > 10000
      || !Number.isInteger(weeklySaleTarget) || Number(weeklySaleTarget) < 0 || Number(weeklySaleTarget) > 10000
      || !Number.isFinite(commissionPerMeeting) || Number(commissionPerMeeting) < 0 || Number(commissionPerMeeting) > 1_000_000
      || !Number.isFinite(commissionPerSale) || Number(commissionPerSale) < 0 || Number(commissionPerSale) > 1_000_000) {
      return apiError("Kontrollér aktivitetstype, ugemål og provisionssatser.");
    }
  } else if (!Number.isInteger(weeklyTarget) || Number(weeklyTarget) < 0 || Number(weeklyTarget) > 10000
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
    if (context.profile.role !== "admin" && context.profile.access_mode !== "all") {
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
  const values: Record<string, unknown> = {
    team_id: context.profile.team_id,
    user_id: body.user_id,
    campaign_id: campaignId,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };
  if (hasActivitySettings) {
    const combinedWeeklyTarget = Number(weeklyMeetingTarget) + Number(weeklySaleTarget);
    Object.assign(values, {
      activity_mode: activityMode,
      // Commission rates feed verified earnings, so only administrators set them.
      ...(context.profile.role === "admin" ? {
        commission_per_meeting: Number(commissionPerMeeting),
        commission_per_sale: Number(commissionPerSale),
      } : {}),
      weekly_meeting_target: Number(weeklyMeetingTarget),
      weekly_sale_target: Number(weeklySaleTarget),
      weekly_target: combinedWeeklyTarget,
      monthly_target: Math.round(combinedWeeklyTarget * 52 / 12),
    });
  } else {
    Object.assign(values, { weekly_target: Number(weeklyTarget), monthly_target: Number(monthlyTarget) });
  }
  // Sellers write through their own session, where the database blocks the
  // commission columns; administrators write commission rates server-side.
  let writer = context.supabase;
  if (context.profile.role === "admin") {
    try {
      writer = createSupabaseAdminClient() as unknown as typeof context.supabase;
    } catch (error) {
      console.error("Budget admin client setup failed", error);
      return apiError("Budgettet kunne ikke gemmes.", 503);
    }
  }
  const write = existingId
    ? await writer.from("sales_targets").update(updatable(values)).eq("id", existingId).eq("team_id", context.profile.team_id).select("id").maybeSingle()
    : await writer.from("sales_targets").insert(values).select("id").maybeSingle();
  if (write.error || !write.data) {
    console.error("Budget target save failed", write.error?.message ?? "No row returned");
    return apiError("Budgetmålet kunne ikke gemmes.", 500);
  }
  await writeAudit(context, "sales_target_updated", "sales_target", write.data.id, {
    user_id: body.user_id, campaign_id: campaignId, ...values,
  });
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
  const [campaign, target] = await Promise.all([
    context.supabase.from("campaigns").select("id").eq("id", body.campaign_id)
      .eq("team_id", context.profile.team_id).maybeSingle(),
    context.supabase.from("sales_targets").select("activity_mode")
      .eq("team_id", context.profile.team_id).eq("user_id", context.user.id)
      .eq("campaign_id", body.campaign_id).maybeSingle(),
  ]);
  if (campaign.error || target.error) {
    console.error("Budget event validation failed", campaign.error?.message ?? target.error?.message);
    return apiError("Aktiviteten kunne ikke valideres.", 500);
  }
  if (!campaign.data) return apiError("Kampagnen blev ikke fundet.", 404);
  if (!target.data) return apiError("Gem først et budget for kampagnen.");
  const activity = body.event_type === "upsell" ? "sale" : body.event_type;
  if (target.data.activity_mode !== "both" && target.data.activity_mode !== activity) {
    return apiError("Denne aktivitetstype er ikke slået til for kampagnens budget.");
  }
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
