import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { data, error } = await result.context.supabase.from("callbacks")
    .select("*, leads(id, company_name, contact_person, phone, status)")
    .is("completed_at", null).order("callback_at", { ascending: true }).limit(300);
  if (error) {
    console.error("Callbacks query failed", error.message);
    return apiError("Kunne ikke hente callbacks.", 500);
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || typeof body.lead_id !== "string" || typeof body.callback_at !== "string" || !Number.isFinite(Date.parse(body.callback_at))) {
    return apiError("Virksomhed samt gyldig callback-dato og -tid er påkrævet.");
  }
  const { context } = result;
  const { data, error } = await context.supabase.from("callbacks").insert({
    team_id: context.profile.team_id,
    lead_id: body.lead_id,
    user_id: context.user.id,
    callback_at: new Date(body.callback_at).toISOString(),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "",
  }).select().single();
  if (error) {
    console.error("Callback creation failed", error.message);
    return apiError("Callback kunne ikke oprettes. Kontrollér, at du har adgang til virksomheden.", 400);
  }
  const { error: leadError } = await context.supabase.from("leads")
    .update({ status: "callback", next_follow_up_at: data.callback_at }).eq("id", body.lead_id);
  if (leadError) {
    console.error("Callback lead update failed", leadError.message);
    return apiError("Callback blev oprettet, men virksomhedens status blev ikke opdateret.", 500);
  }
  await writeAudit(context, "callback_scheduled", "callback", data.id);
  return NextResponse.json({ data }, { status: 201 });
}
