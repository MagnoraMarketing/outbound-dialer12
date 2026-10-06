import { NextResponse } from "next/server";
import { apiError, readJson, requireContext } from "@/lib/http";

const callStatuses = new Set(["initiated", "ringing", "answered", "completed", "failed", "busy", "no_answer", "cancelled"]);
const terminalStatuses = new Set(["completed", "failed", "busy", "no_answer", "cancelled"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || typeof body.status !== "string" || !callStatuses.has(body.status)) {
    return apiError("Ugyldig opkaldsstatus.");
  }
  const { id } = await params;
  const { context } = result;
  const { data: call, error: lookupError } = await context.supabase.from("calls")
    .select("id, user_id, status, started_at, ended_at")
    .eq("id", id)
    .maybeSingle();
  if (lookupError || !call) {
    console.error("WebRTC call status lookup failed", lookupError?.message);
    return apiError("Opkaldet blev ikke fundet.", lookupError ? 500 : 404);
  }
  if (call.user_id !== context.user.id) return apiError("Du kan kun opdatere dine egne opkald.", 403);
  if (call.ended_at) return NextResponse.json({ success: true, status: call.status });

  const status = body.status;
  const endedAt = terminalStatuses.has(status) ? new Date() : null;
  const startedAt = new Date(call.started_at);
  const update = {
    status,
    ...(endedAt ? {
      ended_at: endedAt.toISOString(),
      duration_seconds: Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)),
    } : {}),
  };
  const { error: updateError } = await context.supabase.from("calls").update(update)
    .eq("id", call.id)
    .in("status", ["queued", "initiated", "ringing", "answered"]);
  if (updateError) {
    console.error("WebRTC call status update failed", updateError.message);
    return apiError("Opkaldsstatus kunne ikke gemmes.", 500);
  }
  return NextResponse.json({ success: true, status });
}
