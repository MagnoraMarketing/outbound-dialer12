import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyTelnyxWebhook } from "@/lib/telephony/webhook";
import { isRecord } from "@/lib/leads";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyTelnyxWebhook(
    rawBody,
    request.headers.get("telnyx-signature-ed25519"),
    request.headers.get("telnyx-timestamp"),
  )) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Webhook cannot update call records: service database credentials are missing");
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.payload)) {
    return NextResponse.json({ error: "Invalid Telnyx event" }, { status: 400 });
  }
  const eventType = body.data.event_type;
  const payload = body.data.payload;
  const callId = typeof payload.call_control_id === "string" ? payload.call_control_id : null;
  if (!callId || typeof eventType !== "string") return NextResponse.json({ received: true });
  const client = createClient(url, serviceKey, {
    db: { schema: "nordcall" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: call, error: lookupError } = await client.from("calls")
    .select("id, started_at, status").eq("telnyx_call_id", callId).maybeSingle();
  if (lookupError) {
    console.error("Webhook call lookup failed", lookupError.message);
    return NextResponse.json({ error: "Could not process call event" }, { status: 500 });
  }
  if (!call) {
    console.warn("Telnyx event arrived before its call record was linked", callId);
    return NextResponse.json({ error: "Call record is not available yet" }, { status: 503 });
  }
  if (["completed", "busy", "failed", "no_answer", "cancelled"].includes(call.status)) {
    return NextResponse.json({ received: true });
  }

  const eventStates: Record<string, string> = {
    "call.initiated": "initiated",
    "call.initiated_from_sip": "initiated",
    "call.ringing": "ringing",
    "call.answered": "answered",
    "call.bridged": "answered",
    "call.hangup": "completed",
  };
  const status = eventStates[eventType];
  if (!status) return NextResponse.json({ received: true });
  const update: Record<string, string | number | null> = { status };
  if (eventType === "call.hangup") {
    const hangupCause = typeof payload.hangup_cause === "string" ? payload.hangup_cause.toLowerCase() : "";
    if (hangupCause.includes("busy")) update.status = "busy";
    else if (hangupCause.includes("no answer") || hangupCause.includes("no_answer")) update.status = "no_answer";
    update.ended_at = new Date().toISOString();
    const providerDuration = Number(payload.call_duration_secs);
    update.duration_seconds = Number.isFinite(providerDuration) && providerDuration >= 0
      ? Math.floor(providerDuration)
      : Math.max(0, Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000));
  }
  const { error } = await client.from("calls").update(update).eq("id", call.id);
  if (error) {
    console.error("Webhook call status update failed", error.message);
    return NextResponse.json({ error: "Could not update call" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
