import { NextResponse } from "next/server";
import { apiError, readJson, writeAudit } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";

const NOT_ADMIN = "Kun administratorer kan oprette partnerlogins.";

export async function POST(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const body = await readJson(request);
  const partnerId = typeof body?.partner_id === "string" ? body.partner_id : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError("Skriv en gyldig e-mailadresse.");
  if (password.length < 8) return apiError("Adgangskoden skal være mindst 8 tegn.");
  const { data: partner } = await admin.from("partners").select("id").eq("id", partnerId).eq("team_id", teamId).maybeSingle();
  if (!partner) return apiError("Samarbejdspartneren findes ikke.", 404);

  // No nordcall_app flag: the auth trigger must not create a team profile for partner logins.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, nordcall_partner: true },
  });
  if (createError || !created.user) {
    console.error("Partner login creation failed", createError?.message);
    const exists = createError?.message.toLowerCase().includes("already");
    return apiError(exists ? "E-mailen er allerede i brug. Brug en anden e-mail til partnerens login." : "Partnerens login kunne ikke oprettes.", exists ? 409 : 502);
  }
  const { error } = await admin.from("partner_users").insert({
    user_id: created.user.id, team_id: teamId, partner_id: partnerId, full_name: fullName, email, created_by: context.user.id,
  });
  if (error) {
    console.error("Partner login setup failed", error.message);
    await admin.auth.admin.deleteUser(created.user.id);
    return apiError("Partnerens login kunne ikke oprettes. Prøv igen.", 500);
  }
  await writeAudit(context, "partner_login_created", "partner", partnerId, { email });
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const userId = new URL(request.url).searchParams.get("user_id") ?? "";
  const { data: user } = await admin.from("partner_users").select("user_id, partner_id, email")
    .eq("user_id", userId).eq("team_id", context.profile.team_id).maybeSingle();
  if (!user) return apiError("Login findes ikke.", 404);
  // Partner logins are created by this route only, so removing the auth user is safe.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("Partner login deletion failed", error.message);
    return apiError("Login kunne ikke slettes.", 500);
  }
  await writeAudit(context, "partner_login_deleted", "partner", user.partner_id, { email: user.email });
  return NextResponse.json({ success: true });
}
