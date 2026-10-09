import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";
import { normalizePhone } from "@/lib/leads";
import { resolveCallerNumber } from "@/lib/telephony/numbers";

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || (typeof body.lead_id !== "string" && typeof body.phone !== "string")) return apiError("Vælg en virksomhed eller indtast et telefonnummer.");
  const { context } = result;
  let lead: { id: string; phone: string; status: string; assigned_user_id: string | null; next_follow_up_at: string | null; campaign_id: string | null } | null = null;
  if (typeof body.lead_id === "string") {
    const { data, error: leadError } = await context.supabase.from("leads")
      .select("id, phone, status, assigned_user_id, next_follow_up_at, campaign_id")
      .eq("id", body.lead_id).is("deleted_at", null).maybeSingle();
    if (leadError || !data) return apiError("Virksomheden blev ikke fundet.", leadError ? 500 : 404);
    lead = data;
    if (lead.status === "do_not_call" || lead.status === "wrong_number") return apiError("Denne virksomhed er markeret som må ikke ringes op eller har et ugyldigt nummer.", 409);
    if (lead.assigned_user_id && lead.assigned_user_id !== context.user.id && context.profile.role !== "admin") {
      return apiError("Virksomheden er tildelt en anden sælger.", 403);
    }
    if (lead.next_follow_up_at && new Date(lead.next_follow_up_at) > new Date()) {
      return apiError("Virksomheden har en fremtidig aftalt opringning.", 409);
    }
  }
  if (!lead && context.profile.role !== "admin" && context.profile.can_dial_manual === false) {
    return apiError("Du har ikke adgang til at ringe til frie numre. Kontakt din administrator.", 403);
  }
  const phone = normalizePhone(lead?.phone ?? body.phone);
  if (!phone) return apiError("Telefonnummeret er ugyldigt.", 422);

  if (lead) {
    const { data: activeCall } = await context.supabase.from("calls")
      .select("id").eq("lead_id", lead.id).in("status", ["queued", "initiated", "ringing", "answered"]).maybeSingle();
    if (activeCall) return apiError("En anden bruger håndterer allerede dette opkald.", 409);
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error("Call creation is not configured", error);
    return apiError("Opkaldsoprettelse er ikke konfigureret.", 503);
  }
  // Administrators assign caller numbers; sellers never pick one.
  let callerNumber: string | null;
  try {
    callerNumber = await resolveCallerNumber(admin, context.profile.team_id, lead?.campaign_id ?? null);
  } catch (error) {
    console.error("Caller number lookup failed", error);
    return apiError("Opkaldet kunne ikke forberedes. Prøv igen.", 500);
  }
  if (!callerNumber) {
    return apiError(context.profile.role === "admin"
      ? "Der er intet udgående nummer. Tildel et nummer til kampagnen eller vælg et standardnummer under Telefonnumre."
      : "Der er ikke tildelt et udgående nummer til denne kampagne. Kontakt din administrator.", 409);
  }
  const { data: call, error: insertError } = await admin.from("calls").insert({
    team_id: context.profile.team_id,
    lead_id: lead?.id ?? null,
    user_id: context.user.id,
    phone,
    status: "queued",
    recording_enabled: context.profile.call_recording_enabled,
    caller_number: callerNumber,
  }).select().single();
  if (insertError || !call) {
    console.error("Call record creation failed", insertError?.message);
    return apiError("Opkaldet kunne ikke oprettes. Kontrollér, at virksomheden ikke allerede er i et opkald.", 409);
  }

  if (lead) {
    const { error: leadUpdateError } = await context.supabase.from("leads")
      .update({ last_contacted_at: new Date().toISOString() }).eq("id", lead.id);
    if (leadUpdateError) console.error("Lead contact timestamp could not be updated", leadUpdateError.message);
  }
  await writeAudit(context, "call_started", "call", call.id, { phone, manual: !lead, transport: "webrtc" });
  return NextResponse.json({ data: call }, { status: 201 });
}
