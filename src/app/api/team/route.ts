import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role === "salesperson") return apiError("Kun ledere og administratorer har adgang til teamet.", 403);
  if (context.profile.role !== "admin") {
    const { data, error } = await context.supabase.from("profiles")
      .select("id, full_name, role, created_at").eq("team_id", context.profile.team_id).order("full_name");
    if (error) {
      console.error("Team query failed", error.message);
      return apiError("Kunne ikke hente teamet.", 500);
    }
    return NextResponse.json({ data, campaigns: [], lead_lists: [] });
  }
  try {
    const admin = createSupabaseAdminClient();
    const [profiles, campaigns, lists, campaignAssignments, listAssignments] = await Promise.all([
      admin.from("profiles").select("id, full_name, role, created_at")
        .eq("team_id", context.profile.team_id).order("full_name"),
      admin.from("campaigns").select("id, name, created_at").eq("team_id", context.profile.team_id)
        .order("created_at", { ascending: false }),
      admin.from("lead_lists").select("id, campaign_id, name, created_at").eq("team_id", context.profile.team_id)
        .order("created_at", { ascending: false }),
      admin.from("campaign_assignments").select("user_id, campaign_id")
        .eq("team_id", context.profile.team_id),
      admin.from("lead_list_assignments").select("user_id, lead_list_id")
        .eq("team_id", context.profile.team_id),
    ]);
    const failed = [profiles, campaigns, lists, campaignAssignments, listAssignments].find((query) => query.error);
    if (failed?.error) {
      console.error("Admin team data query failed", failed.error.message);
      return apiError("Teamets brugere og tildelinger kunne ikke hentes.", 500);
    }
    const data = (profiles.data ?? []).map((member) => ({
      ...member,
      campaign_ids: (campaignAssignments.data ?? [])
        .filter((assignment) => assignment.user_id === member.id).map((assignment) => assignment.campaign_id),
      lead_list_ids: (listAssignments.data ?? [])
        .filter((assignment) => assignment.user_id === member.id).map((assignment) => assignment.lead_list_id),
    }));
    return NextResponse.json({ data, campaigns: campaigns.data ?? [], lead_lists: lists.data ?? [] });
  } catch (error) {
    console.error("Admin team setup failed", error);
    return apiError("Teamadministration er ikke konfigureret.", 503);
  }
}

export async function PATCH(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan ændre teamroller.", 403);
  const body = await readJson(request);
  if (typeof body?.user_id !== "string") return apiError("Vælg et teammedlem.");
  const hasRole = body.role !== undefined;
  const hasName = body.full_name !== undefined;
  const hasCampaigns = body.campaign_ids !== undefined;
  const hasLists = body.lead_list_ids !== undefined;
  if (!hasRole && !hasName && !hasCampaigns && !hasLists) return apiError("Der er ingen ændringer at gemme.");
  if (hasRole && !["admin", "manager", "salesperson"].includes(String(body.role))) return apiError("Vælg en gyldig rolle.");
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : null;
  if (hasName && (!fullName || fullName.length > 120)) return apiError("Navnet skal være 1–120 tegn.");
  let campaignIds = hasCampaigns && Array.isArray(body.campaign_ids)
    ? [...new Set(body.campaign_ids.filter((id): id is string => typeof id === "string"))] : null;
  const leadListIds = hasLists && Array.isArray(body.lead_list_ids)
    ? [...new Set(body.lead_list_ids.filter((id): id is string => typeof id === "string"))] : null;
  if ((hasCampaigns && !campaignIds) || (hasLists && !leadListIds)) return apiError("Ugyldigt format på kampagne- eller leadlistetildeling.");
  if ((campaignIds?.length ?? 0) !== ((body.campaign_ids as unknown[])?.length ?? 0)
      || (leadListIds?.length ?? 0) !== ((body.lead_list_ids as unknown[])?.length ?? 0)) {
    return apiError("Tildelingerne indeholder ugyldige id'er.");
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data: member, error: memberError } = await admin.from("profiles")
      .select("id, role").eq("id", body.user_id).eq("team_id", context.profile.team_id).maybeSingle();
    if (memberError || !member) return apiError("Brugeren tilhører ikke dit team.", 404);
    if (member.id === context.user.id && hasRole && body.role !== member.role) {
      return apiError("Du kan ikke ændre din egen administratorrolle.", 409);
    }
    if (campaignIds) {
      const { data, error } = await admin.from("campaigns").select("id")
        .eq("team_id", context.profile.team_id).in("id", campaignIds);
      if (error || data.length !== campaignIds.length) return apiError("En kampagne tilhører ikke dit team.", 400);
    }
    if (leadListIds) {
      const { data, error } = await admin.from("lead_lists").select("id, campaign_id")
        .eq("team_id", context.profile.team_id).in("id", leadListIds);
      if (error || data.length !== leadListIds.length) return apiError("En leadliste tilhører ikke dit team.", 400);
      if (campaignIds) campaignIds = [...new Set([...campaignIds, ...data.map((list) => list.campaign_id)])];
    }
    if (hasRole || hasName) {
      const { error } = await admin.from("profiles").update({
        ...(hasRole ? { role: body.role as "admin" | "manager" | "salesperson" } : {}),
        ...(hasName ? { full_name: fullName! } : {}),
      }).eq("id", member.id).eq("team_id", context.profile.team_id);
      if (error) {
        console.error("Team profile update failed", error.message);
        return apiError("Brugerens profil kunne ikke opdateres.", 500);
      }
    }
    if (campaignIds) {
      const { error } = await admin.from("campaign_assignments").delete()
        .eq("user_id", member.id).eq("team_id", context.profile.team_id);
      if (error) {
        console.error("Campaign assignment replacement failed", error.message);
        return apiError("Kampagnetildelingen kunne ikke opdateres.", 500);
      }
      if (campaignIds.length) {
        const { error: insertError } = await admin.from("campaign_assignments").insert(
          campaignIds.map((campaign_id) => ({ team_id: context.profile.team_id, campaign_id, user_id: member.id })),
        );
        if (insertError) {
          console.error("Campaign assignment insert failed", insertError.message);
          return apiError("Kampagnetildelingen kunne ikke gemmes.", 500);
        }
      }
    }
    if (leadListIds) {
      const { error } = await admin.from("lead_list_assignments").delete()
        .eq("user_id", member.id).eq("team_id", context.profile.team_id);
      if (error) {
        console.error("Lead list assignment replacement failed", error.message);
        return apiError("Leadlistetildelingen kunne ikke opdateres.", 500);
      }
      if (leadListIds.length) {
        const { error: insertError } = await admin.from("lead_list_assignments").insert(
          leadListIds.map((lead_list_id) => ({ team_id: context.profile.team_id, lead_list_id, user_id: member.id })),
        );
        if (insertError) {
          console.error("Lead list assignment insert failed", insertError.message);
          return apiError("Leadlistetildelingen kunne ikke gemmes.", 500);
        }
      }
    }
    await writeAudit(context, "team_member_updated", "profile", member.id, {
      ...(hasRole ? { role: body.role } : {}),
      ...(hasName ? { full_name: fullName } : {}),
      ...(campaignIds ? { campaign_ids: campaignIds } : {}),
      ...(leadListIds ? { lead_list_ids: leadListIds } : {}),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Privileged team role update failed", error);
    return apiError("Teamadministration er ikke konfigureret.", 503);
  }
}
