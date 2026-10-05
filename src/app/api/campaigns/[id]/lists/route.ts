import { NextResponse } from "next/server";
import { apiError, readJson, requireContext } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { id } = await route.params;
  const { data, error } = await result.context.supabase.from("lead_lists")
    .select("id, campaign_id, name, created_at").eq("campaign_id", id)
    .eq("team_id", result.context.profile.team_id).order("created_at", { ascending: false });
  if (error) {
    console.error("Campaign lead lists query failed", error.message);
    return apiError("Kampagnens leadlister kunne ikke hentes.", 500);
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  if (result.context.profile.role !== "admin") return apiError("Kun administratorer kan oprette leadlister.", 403);
  const { id: campaignId } = await route.params;
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) return apiError("Leadlisten skal have et navn på 2–120 tegn.");
  const { context } = result;
  const { data: campaign, error: campaignError } = await context.supabase.from("campaigns")
    .select("id").eq("id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
  if (campaignError || !campaign) return apiError("Kampagnen blev ikke fundet.", campaignError ? 500 : 404);
  const { data, error } = await context.supabase.from("lead_lists").insert({
    team_id: context.profile.team_id,
    campaign_id: campaignId,
    created_by: context.user.id,
    name,
  }).select("id, campaign_id, name, created_at").single();
  if (error) {
    console.error("Lead list creation failed", error.code, error.message);
    return apiError(error.code === "23505" ? "Der findes allerede en leadliste med det navn i kampagnen." : "Leadlisten kunne ikke oprettes.", 400);
  }
  return NextResponse.json({ data }, { status: 201 });
}
