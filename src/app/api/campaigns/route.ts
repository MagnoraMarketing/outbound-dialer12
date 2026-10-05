import { NextResponse } from "next/server";
import { apiError, readJson, requireContext } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { data, error } = await result.context.supabase.from("campaigns")
    .select("id, name, created_at").eq("team_id", result.context.profile.team_id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Campaign list query failed", error.message);
    return apiError("Kampagner kunne ikke hentes.", 500);
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  if (result.context.profile.role !== "admin") return apiError("Kun administratorer kan oprette kampagner.", 403);
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) return apiError("Kampagnen skal have et navn på 2–120 tegn.");
  const { context } = result;
  const { data, error } = await context.supabase.from("campaigns").insert({
    team_id: context.profile.team_id,
    created_by: context.user.id,
    name,
  }).select("id, name, created_at").single();
  if (error) {
    console.error("Campaign creation failed", error.code, error.message);
    return apiError(error.code === "23505" ? "Der findes allerede en kampagne med det navn." : "Kampagnen kunne ikke oprettes.", 400);
  }
  return NextResponse.json({ data }, { status: 201 });
}
