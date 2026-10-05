import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { data, error } = await result.context.supabase.from("meetings")
    .select("*, leads(id, company_name, contact_person, phone)")
    .order("meeting_at", { ascending: true }).limit(300);
  if (error) {
    console.error("Meetings query failed", error.message);
    return apiError("Kunne ikke hente møder.", 500);
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || typeof body.lead_id !== "string" || typeof body.meeting_at !== "string" || !Number.isFinite(Date.parse(body.meeting_at))) {
    return apiError("Virksomhed samt gyldig mødedato og -tid er påkrævet.");
  }
  const { context } = result;
  const { data, error } = await context.supabase.from("meetings").insert({
    team_id: context.profile.team_id,
    lead_id: body.lead_id,
    user_id: context.user.id,
    meeting_at: new Date(body.meeting_at).toISOString(),
    meeting_type: typeof body.meeting_type === "string" ? body.meeting_type.slice(0, 50) : "online",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
    calendar_url: typeof body.calendar_url === "string" ? body.calendar_url.slice(0, 2000) : null,
  }).select().single();
  if (error) {
    console.error("Meeting creation failed", error.message);
    return apiError("Mødet kunne ikke oprettes. Kontrollér, at du har adgang til virksomheden.", 400);
  }
  const { error: leadError } = await context.supabase.from("leads").update({ status: "meeting_booked" }).eq("id", body.lead_id);
  if (leadError) {
    console.error("Meeting lead update failed", leadError.message);
    return apiError("Mødet blev oprettet, men virksomhedens status blev ikke opdateret.", 500);
  }
  await writeAudit(context, "meeting_booked", "meeting", data.id);
  return NextResponse.json({ data }, { status: 201 });
}
