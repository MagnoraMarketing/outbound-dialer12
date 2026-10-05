import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role === "salesperson") return apiError("Kun ledere og administratorer har adgang til teamet.", 403);
  const { data, error } = await context.supabase.from("profiles")
    .select("id, full_name, role, created_at").eq("team_id", context.profile.team_id).order("full_name");
  if (error) {
    console.error("Team query failed", error.message);
    return apiError("Kunne ikke hente teamet.", 500);
  }
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan ændre teamroller.", 403);
  const body = await readJson(request);
  if (typeof body?.user_id !== "string" || !["manager", "salesperson"].includes(String(body.role))) {
    return apiError("Vælg et teammedlem og en gyldig rolle.");
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data: member, error: memberError } = await admin.from("profiles")
      .select("id, role").eq("id", body.user_id).eq("team_id", context.profile.team_id).maybeSingle();
    if (memberError || !member) return apiError("Brugeren tilhører ikke dit team.", 404);
    if (member.id === context.user.id) return apiError("Du kan ikke ændre din egen administratorrolle.", 409);
    const { error } = await admin.from("profiles")
      .update({ role: body.role }).eq("id", member.id).eq("team_id", context.profile.team_id);
    if (error) {
      console.error("Team role update failed", error.message);
      return apiError("Brugerens rolle kunne ikke opdateres.", 500);
    }
    await writeAudit(context, "team_role_changed", "profile", member.id, { role: body.role });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Privileged team role update failed", error);
    return apiError("Teamadministration er ikke konfigureret.", 503);
  }
}
