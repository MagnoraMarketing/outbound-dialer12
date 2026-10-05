import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { telephonyProvider } from "@/lib/telephony/telnyx";

const outcomes = new Set(["answered", "no_answer", "busy", "failed", "interested", "not_interested", "meeting_booked", "callback", "wrong_number"]);

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || typeof body.call_id !== "string") return apiError("Opkald mangler.");
  if (typeof body.outcome !== "string" || !outcomes.has(body.outcome)) return apiError("Vælg et gyldigt opkaldsresultat.");
  if (typeof body.notes === "string" && body.notes.length > 5000) return apiError("Noten er for lang.");
  if (body.outcome === "callback" && (typeof body.callback_at !== "string" || !Number.isFinite(Date.parse(body.callback_at)))) {
    return apiError("Vælg en gyldig dato og tid for callback.");
  }
  const { context } = result;
  const { data: call, error } = await context.supabase.from("calls").select("*").eq("id", body.call_id).maybeSingle();
  if (error || !call) return apiError("Opkaldet blev ikke fundet.", error ? 500 : 404);
  if (call.user_id !== context.user.id) return apiError("Du kan kun afslutte dine egne opkald.", 403);
  if (!call.lead_id && ["callback", "wrong_number"].includes(body.outcome)) {
    return apiError("Callback og ugyldigt nummer kan kun registreres på et lead.");
  }

  if (call.telnyx_call_id && ["queued", "initiated", "ringing", "answered"].includes(call.status)) {
    try {
      await telephonyProvider.endCall(call.telnyx_call_id);
    } catch (hangupError) {
      console.error("Unable to hang up Telnyx call", hangupError);
      return apiError(hangupError instanceof Error ? hangupError.message : "Opkaldet kunne ikke afsluttes.", 502);
    }
  }

  const endedAt = new Date();
  const startedAt = new Date(call.started_at);
  const outcome = body.outcome;
  const status = outcome === "no_answer" ? "no_answer" : outcome === "busy" ? "busy" : outcome === "failed" ? "failed" : "completed";
  const { error: updateError } = await context.supabase.from("calls").update({
    status,
    outcome,
    notes: typeof body.notes === "string" ? body.notes.trim() : "",
    ended_at: endedAt.toISOString(),
    duration_seconds: Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)),
  }).eq("id", call.id);
  if (updateError) {
    console.error("Call result update failed", updateError.message);
    return apiError("Opkaldsresultatet kunne ikke gemmes.", 500);
  }

  if (!call.lead_id) {
    await writeAudit(context, "manual_call_ended", "call", call.id, { outcome, phone: call.phone });
    return NextResponse.json({ success: true, status, outcome });
  }

  const leadStatus = outcome === "meeting_booked" ? "meeting_booked"
    : outcome === "callback" ? "callback"
      : outcome === "no_answer" ? "no_answer"
        : outcome === "wrong_number" ? "wrong_number"
          : outcome === "interested" ? "interested"
            : outcome === "not_interested" ? "not_interested" : "called";
  const leadUpdate: Record<string, string | null> = { status: leadStatus };
  if (typeof body.callback_at === "string" && outcome === "callback" && Number.isFinite(Date.parse(body.callback_at))) {
    leadUpdate.next_follow_up_at = new Date(body.callback_at).toISOString();
    const { error: callbackError } = await context.supabase.from("callbacks").insert({
      team_id: context.profile.team_id,
      lead_id: call.lead_id,
      user_id: context.user.id,
      callback_at: leadUpdate.next_follow_up_at,
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
    });
    if (callbackError) {
      console.error("Callback creation failed", callbackError.message);
      return apiError("Opkaldet blev gemt, men callback kunne ikke oprettes.", 500);
    }
  }
  const { error: leadError } = await context.supabase.from("leads").update(leadUpdate).eq("id", call.lead_id);
  if (leadError) {
    console.error("Lead outcome update failed", leadError.message);
    return apiError("Opkaldet blev gemt, men lead-status kunne ikke opdateres.", 500);
  }
  if (typeof body.notes === "string" && body.notes.trim()) {
    const { error: noteError } = await context.supabase.from("notes").insert({
      team_id: context.profile.team_id,
      lead_id: call.lead_id,
      user_id: context.user.id,
      body: body.notes.trim().slice(0, 5000),
    });
    if (noteError) {
      console.error("Call note could not be saved", noteError.message);
      return apiError("Opkaldet er gemt, men noten kunne ikke gemmes.", 500);
    }
  }
  await writeAudit(context, "call_ended", "call", call.id, { outcome });
  return NextResponse.json({ success: true, status, outcome });
}
