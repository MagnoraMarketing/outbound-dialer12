import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { normalizePhone } from "@/lib/leads";
import { telephonyProvider } from "@/lib/telephony/telnyx";

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || (typeof body.lead_id !== "string" && typeof body.phone !== "string")) return apiError("Vælg en virksomhed eller indtast et telefonnummer.");
  const { context } = result;
  let lead: { id: string; phone: string; status: string; assigned_user_id: string | null; next_follow_up_at: string | null } | null = null;
  if (typeof body.lead_id === "string") {
    const { data, error: leadError } = await context.supabase.from("leads")
      .select("id, phone, status, assigned_user_id, next_follow_up_at")
      .eq("id", body.lead_id).is("deleted_at", null).maybeSingle();
    if (leadError || !data) return apiError("Virksomheden blev ikke fundet.", leadError ? 500 : 404);
    lead = data;
    if (lead.status === "do_not_call" || lead.status === "wrong_number") return apiError("Denne virksomhed er markeret som må ikke ringes op eller har et ugyldigt nummer.", 409);
    if (lead.assigned_user_id && lead.assigned_user_id !== context.user.id && context.profile.role === "salesperson") {
      return apiError("Virksomheden er tildelt en anden sælger.", 403);
    }
    if (lead.next_follow_up_at && new Date(lead.next_follow_up_at) > new Date()) {
      return apiError("Virksomheden har en fremtidig aftalt opringning.", 409);
    }
  }
  const phone = normalizePhone(lead?.phone ?? body.phone);
  if (!phone) return apiError("Telefonnummeret er ugyldigt.", 422);
  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_CONNECTION_ID;
  const callerId = process.env.TELNYX_PHONE_NUMBER;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !connectionId || !callerId || !appUrl) return apiError("Telnyx er ikke konfigureret. Kontakt administratoren.", 503);

  if (lead) {
    const { data: activeCall } = await context.supabase.from("calls")
      .select("id").eq("lead_id", lead.id).in("status", ["queued", "initiated", "ringing", "answered"]).maybeSingle();
    if (activeCall) return apiError("En anden bruger håndterer allerede dette opkald.", 409);
  }

  const { data: call, error: insertError } = await context.supabase.from("calls").insert({
    team_id: context.profile.team_id,
    lead_id: lead?.id ?? null,
    user_id: context.user.id,
    phone,
    status: "queued",
  }).select().single();
  if (insertError || !call) {
    console.error("Call record creation failed", insertError?.message);
    return apiError("Opkaldet kunne ikke oprettes. Kontrollér, at virksomheden ikke allerede er i et opkald.", 409);
  }

  try {
    const { callControlId } = await telephonyProvider.startCall({
      to: phone,
      from: callerId,
      connectionId,
      webhookUrl: `${appUrl.replace(/\/$/, "")}/api/calls/webhook`,
    });
    const { error: updateError } = await context.supabase.from("calls")
      .update({ telnyx_call_id: callControlId, status: "initiated" }).eq("id", call.id);
    if (updateError) {
      console.error("Could not attach Telnyx call ID", updateError.message);
      try {
        await telephonyProvider.endCall(callControlId);
      } catch (hangupError) {
        console.error("Could not stop call after call record update failed", hangupError);
      }
      const { error: failedUpdateError } = await context.supabase.from("calls").update({
        status: "failed",
        outcome: "failed",
        ended_at: new Date().toISOString(),
      }).eq("id", call.id);
      if (failedUpdateError) console.error("Could not mark unregistered Telnyx call as failed", failedUpdateError.message);
      return apiError("Opkaldet er startet, men registreringen fejlede. Kontakt administratoren.", 500);
    }
    if (lead) {
      const { error: leadUpdateError } = await context.supabase.from("leads")
        .update({ last_contacted_at: new Date().toISOString() }).eq("id", lead.id);
      if (leadUpdateError) console.error("Lead contact timestamp could not be updated", leadUpdateError.message);
    }
    await writeAudit(context, "call_started", "call", call.id, { phone, manual: !lead });
    return NextResponse.json({ data: { ...call, telnyx_call_id: callControlId, status: "initiated" } }, { status: 201 });
  } catch (error) {
    console.error("Telnyx outbound call failed", error);
    await context.supabase.from("calls").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", call.id);
    return apiError(error instanceof Error ? error.message : "Opkaldet kunne ikke startes.", 502);
  }
}
