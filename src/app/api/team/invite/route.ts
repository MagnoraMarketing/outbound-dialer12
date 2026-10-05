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
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, team_id: context.profile.team_id },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""}/`,
    });
    if (error || !data.user) {
      console.error("Team invitation failed", error?.message);
      return apiError("Invitationen kunne ikke sendes. Kontrollér Supabase e-mailopsætningen.", 502);
    }
    const { error: profileError } = await admin.from("profiles").update({
      full_name: fullName,
      team_id: context.profile.team_id,
      role: "salesperson",
    }).eq("id", data.user.id);
    if (profileError) {
      console.error("Invited user's team assignment failed", profileError.message);
      return apiError("Invitationen blev sendt, men teamtilknytningen fejlede. Kontakt administratoren.", 500);
    }
    await writeAudit(context, "team_member_invited", "profile", data.user.id, { email });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Team invitation setup failed", error);
    return apiError("Invitationsfunktionen er ikke konfigureret.", 503);
  }
}
