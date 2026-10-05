import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { isLeadStatus } from "@/lib/leads";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body) return apiError("Ugyldig forespørgsel.");
  const { id } = await route.params;
  const { context } = result;
  const update: Record<string, string | number | null> = {};
  if (isLeadStatus(body.status)) update.status = body.status;
  if (typeof body.notes === "string") update.notes = body.notes.slice(0, 5000);
  if (typeof body.assigned_user_id === "string" || body.assigned_user_id === null) {
    if (context.profile.role === "salesperson") return apiError("Kun administratorer og ledere kan ændre ansvarlig.", 403);
    if (typeof body.assigned_user_id === "string") {
      const { data: assigned, error: assignedError } = await context.supabase.from("profiles")
        .select("id").eq("id", body.assigned_user_id).eq("team_id", context.profile.team_id).maybeSingle();
      if (assignedError || !assigned) return apiError("Den valgte sælger tilhører ikke dit team.");
    }
    update.assigned_user_id = body.assigned_user_id;
  }
  if (typeof body.next_follow_up_at === "string" || body.next_follow_up_at === null) {
    update.next_follow_up_at = body.next_follow_up_at;
    if (body.next_follow_up_at) update.status = "callback";
  }
  if (!Object.keys(update).length) return apiError("Ingen gyldige ændringer.");
  const { data, error } = await context.supabase.from("leads").update(update).eq("id", id).select().maybeSingle();
  if (error || !data) {
    if (error) console.error("Lead update failed", error.message);
    return apiError("Virksomheden kunne ikke opdateres.", error ? 400 : 404);
  }
  await writeAudit(context, "updated", "lead", id, { fields: Object.keys(update) });
  return NextResponse.json({ data });
}

export async function DELETE(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { id } = await route.params;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan slette virksomheder.", 403);
  const { data, error } = await context.supabase.from("leads")
    .delete().eq("id", id).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Lead deletion failed", error.message);
    return apiError("Virksomheden kunne ikke slettes.", error ? 400 : 404);
  }
  await writeAudit(context, "deleted", "lead", id);
  return NextResponse.json({ success: true });
}
