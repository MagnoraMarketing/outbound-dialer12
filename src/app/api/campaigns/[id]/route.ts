import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { isEmailAddress } from "@/lib/campaign-email";

type RouteContext = { params: Promise<{ id: string }> };

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

// Saves a campaign's calendar and follow-up e-mail settings.
export async function PATCH(request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan ændre kampagner.", 403);
  const { id } = await route.params;
  const body = await readJson(request);
  if (!body) return apiError("Ugyldige data.");
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = text(body.name, 120) ?? "";
    if (name.length < 2) return apiError("Kampagnen skal have et navn på 2–120 tegn.");
    update.name = name;
  }
  if (body.calendar_url !== undefined) {
    const url = text(body.calendar_url, 2000) ?? "";
    if (url && !/^https:\/\//i.test(url)) return apiError("Kalenderlinket skal starte med https://.");
    update.calendar_url = url || null;
  }
  if (body.email_enabled !== undefined) update.email_enabled = body.email_enabled === true;
  for (const [field, max] of [["email_from_name", 120], ["email_subject", 200], ["email_body", 10000]] as const) {
    if (body[field] !== undefined) update[field] = text(body[field], max) ?? "";
  }
  if (body.email_reply_to !== undefined) {
    const replyTo = text(body.email_reply_to, 200) ?? "";
    if (replyTo && !isEmailAddress(replyTo)) return apiError("Svar-til skal være en gyldig e-mailadresse.");
    update.email_reply_to = replyTo;
  }
  if (update.email_enabled === true && body.email_subject !== undefined && !update.email_subject) {
    return apiError("Skriv et emne til e-mailen, før du slår den til.");
  }
  if (!Object.keys(update).length) return apiError("Der er intet at gemme.");
  const { data, error } = await context.supabase.from("campaigns").update(update)
    .eq("id", id).eq("team_id", context.profile.team_id)
    .select("id, name, calendar_url, email_enabled, email_from_name, email_reply_to, email_subject, email_body").maybeSingle();
  if (error) {
    console.error("Campaign update failed", error.code, error.message);
    if (error.code === "23505") return apiError("Der findes allerede en kampagne med det navn.");
    if (error.code === "42703") return apiError("Kampagneindstillinger kræver, at den nyeste databasemigration er kørt.", 503);
    return apiError("Kampagnen kunne ikke gemmes.", 500);
  }
  if (!data) return apiError("Kampagnen blev ikke fundet.", 404);
  await writeAudit(context, "updated", "campaign", id, { fields: Object.keys(update) });
  return NextResponse.json({ data });
}
