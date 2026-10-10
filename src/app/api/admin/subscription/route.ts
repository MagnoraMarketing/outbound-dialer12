import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";

const PLAN_LABELS: Record<string, string> = {
  trial: "Gratis prøve", minutes_1000: "Outbound 1.000", minutes_2000: "Outbound 2.000", internal: "Intern",
};
const AIBOOKING_URL = process.env.AIBOOKING_OUTBOUND_URL ?? "https://aibooking.dk";

// The team's Outbound plan and the talk minutes used in the current period.
// Minutes are shown only; calls are never blocked when a plan runs out.
export async function GET() {
  const result = await requireAdmin("Kun administratorer kan se abonnementet.");
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const { data: subscription, error } = await admin.from("outbound_subscriptions")
    .select("plan, status, included_minutes, trial_ends_at, current_period_start, current_period_end")
    .eq("team_id", teamId).maybeSingle();
  if (error) {
    console.error("Subscription query failed", error.message);
    return apiError("Abonnementet kunne ikke hentes.", 500);
  }
  const periodStart = subscription?.current_period_start
    ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  let query = admin.from("calls").select("duration_seconds").eq("team_id", teamId).gte("started_at", periodStart);
  if (subscription?.current_period_end) query = query.lt("started_at", subscription.current_period_end);
  const { data: calls, error: callsError } = await query.limit(20000);
  if (callsError) {
    console.error("Usage query failed", callsError.message);
    return apiError("Forbruget kunne ikke hentes.", 500);
  }
  // Each call is billed in started minutes.
  const usedMinutes = (calls ?? []).reduce((sum, call) => sum + Math.ceil(Math.max(0, call.duration_seconds ?? 0) / 60), 0);
  return NextResponse.json({
    subscription: subscription ? { ...subscription, label: PLAN_LABELS[subscription.plan] ?? subscription.plan } : null,
    usage: { used_minutes: usedMinutes, period_start: periodStart, calls: (calls ?? []).length },
    manage_url: AIBOOKING_URL,
  });
}
