import { NextResponse } from "next/server";
import { apiError, readJson, writeAudit } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";

const NOT_ADMIN = "Kun administratorer kan administrere samarbejdspartnere.";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const [partners, campaigns, users] = await Promise.all([
    admin.from("partners").select("id, name, contact_name, contact_email, contact_phone, created_at").eq("team_id", teamId).order("name"),
    admin.from("campaigns").select("id, name, partner_id, created_at").eq("team_id", teamId).order("name"),
    admin.from("partner_users").select("user_id, partner_id, full_name, email, created_at").eq("team_id", teamId).order("email"),
  ]);
  const failed = [partners, campaigns, users].find((query) => query.error);
  if (failed?.error) {
    console.error("Partner list query failed", failed.error.message);
    return apiError("Samarbejdspartnerne kunne ikke hentes.", 500);
  }
  return NextResponse.json({
    data: (partners.data ?? []).map((partner) => ({
      ...partner,
      campaign_ids: (campaigns.data ?? []).filter((campaign) => campaign.partner_id === partner.id).map((campaign) => campaign.id),
      users: (users.data ?? []).filter((user) => user.partner_id === partner.id)
        .map(({ user_id, full_name, email, created_at }) => ({ user_id, full_name, email, created_at })),
    })),
    campaigns: (campaigns.data ?? []).map(({ id, name, partner_id }) => ({ id, name, partner_id })),
  });
}

export async function POST(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const body = await readJson(request);
  const name = text(body?.name, 160);
  if (name.length < 2) return apiError("Skriv samarbejdspartnerens navn (mindst 2 tegn).");
  const { data, error } = await admin.from("partners").insert({
    team_id: context.profile.team_id,
    name,
    contact_name: text(body?.contact_name, 120),
    contact_email: text(body?.contact_email, 200),
    contact_phone: text(body?.contact_phone, 40),
    created_by: context.user.id,
  }).select("id").single();
  if (error) {
    console.error("Partner creation failed", error.message);
    return apiError("Samarbejdspartneren kunne ikke oprettes.", 500);
  }
  await writeAudit(context, "partner_created", "partner", data.id, { name });
  return NextResponse.json({ data }, { status: 201 });
}

// Updates contact details and/or which campaigns belong to the partner.
export async function PATCH(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const body = await readJson(request);
  const partnerId = typeof body?.id === "string" ? body.id : "";
  const { data: partner } = await admin.from("partners").select("id").eq("id", partnerId).eq("team_id", teamId).maybeSingle();
  if (!partner) return apiError("Samarbejdspartneren findes ikke.", 404);

  const details: Record<string, string> = {};
  if (body?.name !== undefined) {
    details.name = text(body.name, 160);
    if (details.name.length < 2) return apiError("Navnet skal være mindst 2 tegn.");
  }
  if (body?.contact_name !== undefined) details.contact_name = text(body.contact_name, 120);
  if (body?.contact_email !== undefined) details.contact_email = text(body.contact_email, 200);
  if (body?.contact_phone !== undefined) details.contact_phone = text(body.contact_phone, 40);
  if (Object.keys(details).length) {
    const { error } = await admin.from("partners").update(details).eq("id", partnerId).eq("team_id", teamId);
    if (error) {
      console.error("Partner update failed", error.message);
      return apiError("Samarbejdspartneren kunne ikke gemmes.", 500);
    }
  }

  if (body?.campaign_ids !== undefined) {
    if (!Array.isArray(body.campaign_ids)) return apiError("Vælg gyldige kampagner.");
    const campaignIds = [...new Set(body.campaign_ids.filter((id): id is string => typeof id === "string"))];
    if (campaignIds.length) {
      const { data: owned } = await admin.from("campaigns").select("id").eq("team_id", teamId).in("id", campaignIds);
      if ((owned?.length ?? 0) !== campaignIds.length) return apiError("En eller flere kampagner findes ikke.");
    }
    const release = admin.from("campaigns").update({ partner_id: null }).eq("team_id", teamId).eq("partner_id", partnerId);
    const { error: releaseError } = campaignIds.length
      ? await release.not("id", "in", `(${campaignIds.join(",")})`)
      : await release;
    const { error: assignError } = releaseError || !campaignIds.length
      ? { error: releaseError }
      : await admin.from("campaigns").update({ partner_id: partnerId }).eq("team_id", teamId).in("id", campaignIds);
    if (assignError) {
      console.error("Partner campaign update failed", assignError.message);
      return apiError("Kampagnerne kunne ikke gemmes.", 500);
    }
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const partnerId = new URL(request.url).searchParams.get("id") ?? "";
  const { data: partner } = await admin.from("partners").select("id, name").eq("id", partnerId).eq("team_id", teamId).maybeSingle();
  if (!partner) return apiError("Samarbejdspartneren findes ikke.", 404);
  const { data: users } = await admin.from("partner_users").select("user_id").eq("partner_id", partnerId);
  for (const user of users ?? []) {
    const { error } = await admin.auth.admin.deleteUser(user.user_id);
    if (error) {
      console.error("Partner login deletion failed", error.message);
      return apiError("Partnerens logins kunne ikke slettes.", 500);
    }
  }
  // Campaigns are kept; they just no longer belong to a partner.
  const { error } = await admin.from("partners").delete().eq("id", partnerId).eq("team_id", teamId);
  if (error) {
    console.error("Partner deletion failed", error.message);
    return apiError("Samarbejdspartneren kunne ikke slettes.", 500);
  }
  await writeAudit(context, "partner_deleted", "partner", partnerId, { name: partner.name });
  return NextResponse.json({ success: true });
}
