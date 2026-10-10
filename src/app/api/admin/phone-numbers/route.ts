import { NextResponse } from "next/server";
import { apiError, readJson, writeAudit } from "@/lib/http";
import { requireAdmin } from "@/lib/admin-context";
import { listProviderNumbers, normalizeCallerNumber, type ProviderNumber } from "@/lib/telephony/numbers";
import { isUuid } from "@/lib/game";

const NOT_ADMIN = "Kun administratorer kan administrere telefonnumre.";

// Team numbers, campaign assignments and the numbers available on the
// telephony account.
export async function GET() {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const [numbers, campaigns] = await Promise.all([
    admin.from("phone_numbers").select("id, number, provider_id, label, is_default, created_at").eq("team_id", teamId).order("created_at"),
    admin.from("campaigns").select("id, name, phone_number_id").eq("team_id", teamId).order("name"),
  ]);
  if (numbers.error || campaigns.error) {
    console.error("Phone number query failed", numbers.error?.message ?? campaigns.error?.message);
    return apiError("Telefonnumrene kunne ikke hentes.", 500);
  }
  let provider: { numbers: ProviderNumber[]; error: string | null };
  try {
    provider = { numbers: await listProviderNumbers(), error: null };
  } catch (error) {
    provider = { numbers: [], error: error instanceof Error ? error.message : "Numrene kunne ikke hentes." };
  }
  return NextResponse.json({
    data: numbers.data ?? [],
    campaigns: campaigns.data ?? [],
    provider,
    env_fallback: normalizeCallerNumber(process.env.TELNYX_PHONE_NUMBER),
  });
}

// Adds a number to the team. Numbers picked from the provider list are checked
// against the account; manually typed numbers must be valid E.164.
export async function POST(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const body = await readJson(request);
  const number = normalizeCallerNumber(body?.number);
  const providerId = typeof body?.provider_id === "string" && body.provider_id ? body.provider_id : null;
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";
  if (!number) return apiError("Skriv nummeret i internationalt format, f.eks. +4512345678.");
  if (providerId) {
    try {
      const available = await listProviderNumbers();
      if (!available.some((item) => item.id === providerId && normalizeCallerNumber(item.phone_number) === number)) {
        return apiError("Nummeret findes ikke på telefonikontoen.", 404);
      }
    } catch (error) {
      return apiError(error instanceof Error ? error.message : "Numrene kunne ikke kontrolleres.", 502);
    }
  }
  const { count } = await admin.from("phone_numbers").select("id", { count: "exact", head: true }).eq("team_id", context.profile.team_id);
  const { data, error } = await admin.from("phone_numbers").insert({
    team_id: context.profile.team_id, number, provider_id: providerId, label, created_by: context.user.id,
    // The first number becomes the default so calls work right away.
    is_default: (count ?? 0) === 0,
  }).select("id").single();
  if (error) {
    console.error("Phone number insert failed", error.message);
    return apiError(error.code === "23505" ? "Nummeret er allerede tilføjet." : "Nummeret kunne ikke tilføjes.", error.code === "23505" ? 409 : 500);
  }
  await writeAudit(context, "phone_number_added", "phone_number", data.id, { number });
  return NextResponse.json({ data }, { status: 201 });
}

// Either updates a number (label, default) or assigns a number to a campaign.
export async function PATCH(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const teamId = context.profile.team_id;
  const body = await readJson(request);

  if (isUuid(body?.campaign_id)) {
    // A number picked straight from the telephony account is added to the
    // team first, so the admin does not have to add it in a separate step.
    if (typeof body.provider_id === "string" && body.provider_id) {
      let picked: ProviderNumber | undefined;
      try {
        picked = (await listProviderNumbers()).find((item) => item.id === body.provider_id);
      } catch (error) {
        return apiError(error instanceof Error ? error.message : "Numrene kunne ikke kontrolleres.", 502);
      }
      const number = normalizeCallerNumber(picked?.phone_number);
      if (!picked || !number) return apiError("Nummeret findes ikke på telefonikontoen.", 404);
      const { data: existing } = await admin.from("phone_numbers").select("id").eq("team_id", teamId).eq("number", number).maybeSingle();
      let numberId = existing?.id as string | undefined;
      if (!numberId) {
        const { count } = await admin.from("phone_numbers").select("id", { count: "exact", head: true }).eq("team_id", teamId);
        const { data: inserted, error: insertError } = await admin.from("phone_numbers").insert({
          team_id: teamId, number, provider_id: picked.id, label: "", created_by: context.user.id, is_default: (count ?? 0) === 0,
        }).select("id").single();
        if (insertError || !inserted) return apiError("Nummeret kunne ikke tilføjes.", 500);
        numberId = inserted.id;
        await writeAudit(context, "phone_number_added", "phone_number", inserted.id, { number });
      }
      body.phone_number_id = numberId;
    }
    const phoneNumberId = body.phone_number_id === null ? null : isUuid(body.phone_number_id) ? body.phone_number_id : undefined;
    if (phoneNumberId === undefined) return apiError("Vælg et nummer eller standardnummeret.");
    if (phoneNumberId) {
      const { data: owned } = await admin.from("phone_numbers").select("id").eq("id", phoneNumberId).eq("team_id", teamId).maybeSingle();
      if (!owned) return apiError("Nummeret findes ikke.", 404);
    }
    const { data, error } = await admin.from("campaigns").update({ phone_number_id: phoneNumberId })
      .eq("id", body.campaign_id).eq("team_id", teamId).select("id").maybeSingle();
    if (error) return apiError("Kampagnens nummer kunne ikke gemmes.", 500);
    if (!data) return apiError("Kampagnen findes ikke.", 404);
    await writeAudit(context, "campaign_number_assigned", "campaign", body.campaign_id, { phone_number_id: phoneNumberId });
    return NextResponse.json({ success: true });
  }

  if (!isUuid(body?.id)) return apiError("Vælg et nummer.");
  const { data: number } = await admin.from("phone_numbers").select("id").eq("id", body.id).eq("team_id", teamId).maybeSingle();
  if (!number) return apiError("Nummeret findes ikke.", 404);
  if (typeof body.label === "string") {
    const { error } = await admin.from("phone_numbers").update({ label: body.label.trim().slice(0, 80) }).eq("id", body.id);
    if (error) return apiError("Navnet kunne ikke gemmes.", 500);
  }
  if (body.is_default === true) {
    const { error: clearError } = await admin.from("phone_numbers").update({ is_default: false }).eq("team_id", teamId).neq("id", body.id);
    const { error } = clearError ? { error: clearError } : await admin.from("phone_numbers").update({ is_default: true }).eq("id", body.id);
    if (error) return apiError("Standardnummeret kunne ikke gemmes.", 500);
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const result = await requireAdmin(NOT_ADMIN);
  if ("response" in result) return result.response;
  const { context, admin } = result;
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return apiError("Vælg et nummer.");
  // Campaigns using the number fall back to the team default.
  const { data, error } = await admin.from("phone_numbers").delete().eq("id", id).eq("team_id", context.profile.team_id).select("number").maybeSingle();
  if (error) return apiError("Nummeret kunne ikke fjernes.", 500);
  if (!data) return apiError("Nummeret findes ikke.", 404);
  await writeAudit(context, "phone_number_removed", "phone_number", id, { number: data.number });
  return NextResponse.json({ success: true });
}
