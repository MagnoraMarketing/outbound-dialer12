import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const { id } = await route.params;
  const [lead, calls, notes, meetings] = await Promise.all([
    context.supabase.from("leads").select("id").eq("id", id).is("deleted_at", null).maybeSingle(),
    context.supabase.from("calls")
      .select("id, user_id, started_at, duration_seconds, status, outcome, notes, recording_url")
      .eq("lead_id", id).order("started_at", { ascending: false }).limit(50),
    context.supabase.from("notes")
      .select("id, user_id, body, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
    context.supabase.from("meetings")
      .select("id, user_id, meeting_at, meeting_type, notes, created_at")
      .eq("lead_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  if (lead.error || !lead.data) return apiError("Virksomheden blev ikke fundet eller er ikke tildelt dig.", lead.error ? 500 : 404);
  const failed = [calls.error, notes.error, meetings.error].find(Boolean);
  if (failed) {
    console.error("Lead history query failed", failed.message);
    return apiError("Virksomhedens historik kunne ikke hentes.", 500);
  }
  const activities = [
    ...(calls.data ?? []).map((call) => ({
      id: call.id, kind: "call" as const, user_id: call.user_id, created_at: call.started_at,
      title: call.outcome || call.status, body: call.notes, duration_seconds: call.duration_seconds,
      recording_url: context.profile.role === "admin" && call.recording_url
        ? `/api/calls/${call.id}/recording`
        : null,
    })),
    ...(notes.data ?? []).map((note) => ({
      id: note.id, kind: "note" as const, user_id: note.user_id, created_at: note.created_at,
      title: "Note", body: note.body, duration_seconds: null, recording_url: null,
    })),
    ...(meetings.data ?? []).map((meeting) => ({
      id: meeting.id, kind: "meeting" as const, user_id: meeting.user_id, created_at: meeting.created_at,
      title: `Møde · ${meeting.meeting_type}`, body: meeting.notes, duration_seconds: null, recording_url: null,
    })),
  ].sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 50);
  return NextResponse.json({ data: activities });
}
