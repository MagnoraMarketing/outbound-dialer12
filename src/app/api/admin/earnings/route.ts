import { NextResponse } from "next/server";
import { apiError, readJson, writeAudit } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";
import { isUuid } from "@/lib/game";
import { periodBoundaries } from "@/lib/copenhagen-time";
import { DEFAULT_SYSTEM_FEE_DKK, splitEarnings } from "@/lib/system-fee";

const NOT_ADMIN = "Kun administratorer kan godkende salgsindtjening.";

type MeetingRow = { id: string; user_id: string; meeting_at: string; leads: { company_name: string; campaign_id: string | null } | null };
type SaleRow = { id: string; user_id: string; campaign_id: string; event_type: "sale" | "upsell"; created_at: string };

// Meetings and recorded sales awaiting (or with) an earnings decision. The
// suggested DKK amount is the configured commission for the seller and campaign.
export async function GET() {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const [meetings, sales, decisions, profiles, campaigns, targets, feedback, team] = await Promise.all([
    admin.from("meetings").select("id, user_id, meeting_at, leads(company_name, campaign_id)")
      .eq("team_id", teamId).gte("meeting_at", since).order("meeting_at", { ascending: false }).limit(1000),
    admin.from("budget_events").select("id, user_id, campaign_id, event_type, created_at")
      .eq("team_id", teamId).in("event_type", ["sale", "upsell"]).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    admin.from("earning_approvals").select("user_id, source_type, source_id, status, amount_dkk, decided_at").eq("team_id", teamId),
    admin.from("profiles").select("id, full_name").eq("team_id", teamId),
    admin.from("campaigns").select("id, name").eq("team_id", teamId),
    admin.from("sales_targets").select("user_id, campaign_id, commission_per_meeting, commission_per_sale").eq("team_id", teamId),
    admin.from("meeting_feedback").select("meeting_id, status").eq("team_id", teamId),
    admin.from("teams").select("seller_system_fee_dkk").eq("id", teamId).maybeSingle(),
  ]);
  const failed = [meetings, sales, decisions, profiles, campaigns, targets, feedback, team].find((query) => query.error);
  if (failed?.error) {
    console.error("Earnings queue query failed", failed.error.message);
    return apiError("Godkendelseslisten kunne ikke hentes.", 500);
  }
  const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.full_name || "Uden navn"]));
  const campaignNames = new Map((campaigns.data ?? []).map((campaign) => [campaign.id, campaign.name]));
  const decided = new Map((decisions.data ?? []).map((row) => [`${row.source_type}:${row.source_id}`, row]));
  const partnerStatus = new Map((feedback.data ?? []).map((row) => [row.meeting_id, row.status]));
  const commission = (userId: string, campaignId: string | null, field: "commission_per_meeting" | "commission_per_sale") => {
    const rows = targets.data ?? [];
    const match = rows.find((row) => row.user_id === userId && row.campaign_id === campaignId)
      ?? rows.find((row) => row.user_id === userId && row.campaign_id === null);
    return Number(match?.[field] ?? 0);
  };
  const decision = (key: string) => {
    const row = decided.get(key);
    return row ? { status: row.status, amount_dkk: Number(row.amount_dkk), decided_at: row.decided_at } : null;
  };
  const items = [
    ...((meetings.data ?? []) as unknown as MeetingRow[]).map((meeting) => ({
      source_type: "meeting" as const, source_id: meeting.id, user_id: meeting.user_id, seller_name: names.get(meeting.user_id) ?? "Uden navn",
      occurred_at: meeting.meeting_at, company_name: meeting.leads?.company_name ?? "Virksomhed",
      campaign_name: meeting.leads?.campaign_id ? campaignNames.get(meeting.leads.campaign_id) ?? "" : "",
      partner_status: partnerStatus.get(meeting.id) ?? null,
      suggested_dkk: commission(meeting.user_id, meeting.leads?.campaign_id ?? null, "commission_per_meeting"),
      decision: decision(`meeting:${meeting.id}`),
    })),
    ...((sales.data ?? []) as SaleRow[]).map((sale) => ({
      source_type: sale.event_type, source_id: sale.id, user_id: sale.user_id, seller_name: names.get(sale.user_id) ?? "Uden navn",
      occurred_at: sale.created_at, company_name: null, campaign_name: campaignNames.get(sale.campaign_id) ?? "",
      partner_status: null, suggested_dkk: commission(sale.user_id, sale.campaign_id, "commission_per_sale"),
      decision: decision(`${sale.event_type}:${sale.id}`),
    })),
  ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  // This month's approved earnings per seller, split into system coverage and the seller's own part.
  const feeDkk = Number(team.data?.seller_system_fee_dkk ?? DEFAULT_SYSTEM_FEE_DKK);
  const { monthStart, nextMonth } = periodBoundaries();
  const approvedByUser = new Map<string, number>();
  for (const row of decisions.data ?? []) {
    const decidedAt = new Date(row.decided_at).getTime();
    if (row.status !== "approved" || decidedAt < monthStart.getTime() || decidedAt >= nextMonth.getTime()) continue;
    approvedByUser.set(row.user_id, (approvedByUser.get(row.user_id) ?? 0) + Number(row.amount_dkk));
  }
  const month = [...approvedByUser].map(([userId, gross]) => ({ user_id: userId, seller_name: names.get(userId) ?? "Uden navn", ...splitEarnings(gross, feeDkk) }))
    .sort((a, b) => b.gross - a.gross);
  return NextResponse.json({ data: items, system_fee: { fee_dkk: feeDkk, month } });
}

// Sets the monthly amount every seller covers the system with before earning.
export async function PATCH(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const body = await readJson(request);
  const fee = Number(body?.seller_system_fee_dkk);
  if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) return apiError("Beløbet skal være mellem 0 og 1.000.000 DKK.");
  const rounded = Math.round(fee * 100) / 100;
  const { error } = await admin.from("teams").update({ seller_system_fee_dkk: rounded }).eq("id", context.profile.team_id);
  if (error) {
    console.error("System fee update failed", error.message);
    return apiError("Beløbet kunne ikke gemmes.", 500);
  }
  await writeAudit(context, "seller_system_fee_updated", "team", context.profile.team_id, { seller_system_fee_dkk: rounded });
  return NextResponse.json({ success: true });
}

// Approves or rejects one meeting or sale and sets its verified DKK amount.
export async function PUT(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const body = await readJson(request);
  const sourceType = typeof body?.source_type === "string" ? body.source_type : "";
  const status = body?.status;
  const amount = Number(body?.amount_dkk ?? 0);
  if (!["meeting", "sale", "upsell"].includes(sourceType) || !isUuid(body?.source_id)) return apiError("Vælg et møde, salg eller mersalg.");
  if (status !== "approved" && status !== "rejected") return apiError("Vælg godkend eller afvis.");
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return apiError("Beløbet skal være mellem 0 og 10.000.000 DKK.");

  // The seller is always taken from the source record, never from the request.
  const source = sourceType === "meeting"
    ? await admin.from("meetings").select("user_id").eq("id", body.source_id).eq("team_id", teamId).maybeSingle()
    : await admin.from("budget_events").select("user_id").eq("id", body.source_id).eq("team_id", teamId).eq("event_type", sourceType).maybeSingle();
  if (source.error) return apiError("Kilden kunne ikke findes.", 500);
  if (!source.data) return apiError(sourceType === "meeting" ? "Mødet findes ikke." : "Salget findes ikke.", 404);

  const { error } = await admin.from("earning_approvals").upsert({
    team_id: teamId,
    user_id: source.data.user_id,
    source_type: sourceType,
    source_id: body.source_id,
    status,
    amount_dkk: status === "approved" ? Math.round(amount * 100) / 100 : 0,
    decided_by: context.user.id,
    decided_at: new Date().toISOString(),
  }, { onConflict: "source_type,source_id" });
  if (error) {
    console.error("Earnings decision failed", error.message);
    return apiError("Beslutningen kunne ikke gemmes.", 500);
  }
  // Apply rewards and market access right away; failure here is retried on the seller's next visit.
  const { error: syncError } = await admin.rpc("game_sync", { p_user: source.data.user_id });
  if (syncError) console.error("Game sync after approval failed", syncError.message);
  await writeAudit(context, `earning_${status}`, sourceType, body.source_id, { amount_dkk: amount });
  return NextResponse.json({ success: true });
}
