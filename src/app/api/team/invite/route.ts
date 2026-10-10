import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan invitere kolleger.", 403);
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) return apiError("Udfyld et gyldigt navn og en e-mailadresse.");
  try {
    const admin = createSupabaseAdminClient();
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    const appUrl = configuredAppUrl?.startsWith("https://") ? configuredAppUrl : new URL(request.url).origin;
    const inviteRedirect = new URL("/auth/callback", appUrl);
    inviteRedirect.searchParams.set("next", "/");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, team_id: context.profile.team_id, nordcall_app: true },
      redirectTo: inviteRedirect.toString(),
    });
    // The project is shared with aibooking, so the colleague may already have
    // a login. Add that login to the team instead; they sign in with their
    // existing password.
    if (error && (error.code === "email_exists" || /already been registered/i.test(error.message))) {
      const { data: added, error: addError } = await admin.rpc("add_existing_user_to_team", {
        p_email: email, p_team: context.profile.team_id, p_full_name: fullName,
      });
      const outcome = (added as { result?: string; user_id?: string } | null)?.result;
      if (addError || !outcome) {
        console.error("Adding existing user to team failed", addError?.message);
        return apiError("Brugeren findes allerede, men kunne ikke tilføjes til teamet.", 500);
      }
      if (outcome === "already_member") return apiError("Brugeren er allerede med i dit team.", 409);
      if (outcome === "other_team") return apiError("Brugeren er allerede med i et andet team.", 409);
      if (outcome === "partner_account") return apiError("E-mailen bruges af et samarbejdspartner-login og kan ikke blive sælger.", 409);
      if (outcome !== "added") return apiError("Brugeren kunne ikke tilføjes til teamet.", 500);
      await writeAudit(context, "team_member_added_existing", "profile", (added as { user_id: string }).user_id, { email });
      return NextResponse.json({ success: true, existing: true }, { status: 201 });
    }
    if (error || !data.user) {
      console.error("Team invitation failed", error?.message);
      return apiError("Invitationen kunne ikke sendes. Kontrollér e-mailopsætningen.", 502);
    }
    const { data: profile, error: profileError } = await admin.from("profiles").update({
      full_name: fullName,
      team_id: context.profile.team_id,
      role: "salesperson",
    }).eq("id", data.user.id).select("id").maybeSingle();
    if (profileError || !profile) {
      console.error("Invited user's team assignment failed", profileError?.message ?? "Profile not found");
      return apiError("Invitationen blev sendt, men teamtilknytningen fejlede. Kontakt administratoren.", 500);
    }
    await writeAudit(context, "team_member_invited", "profile", data.user.id, { email });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Team invitation setup failed", error);
    return apiError("Invitationsfunktionen er ikke konfigureret.", 503);
  }
}
