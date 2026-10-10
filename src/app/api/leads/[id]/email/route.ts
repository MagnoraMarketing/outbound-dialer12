import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  defaultEmailBody, defaultEmailSubject, emailProviderConfigured, isEmailAddress, renderEmailTemplate, sendEmail,
  type CampaignEmailSettings,
} from "@/lib/campaign-email";

type RouteContext = { params: Promise<{ id: string }> };
type AuthContext = { supabase: SupabaseClient; user: User; profile: { team_id: string; full_name: string } };

async function loadDraft(context: AuthContext, leadId: string) {
  const { data: lead, error } = await context.supabase.from("leads")
    .select("id, company_name, contact_person, email, campaign_id").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (error || !lead) return { response: apiError("Virksomheden blev ikke fundet eller er ikke tildelt dig.", error ? 500 : 404) } as const;
  if (!lead.campaign_id) return { response: apiError("Virksomheden er ikke knyttet til en kampagne.") } as const;
  const { data: campaign, error: campaignError } = await context.supabase.from("campaigns")
    .select("name, calendar_url, email_enabled, email_from_name, email_reply_to, email_subject, email_body")
    .eq("id", lead.campaign_id).maybeSingle();
  if (campaignError || !campaign) {
    if (campaignError?.code === "42703") return { response: apiError("E-mail efter samtale er ikke sat op endnu.", 503) } as const;
    return { response: apiError("Kampagnen blev ikke fundet.", campaignError ? 500 : 404) } as const;
  }
  const settings = campaign as CampaignEmailSettings;
  if (!settings.email_enabled) return { response: apiError("E-mail efter samtale er ikke slået til for kampagnen. Det sættes op under Kampagner.") } as const;
  const merge = {
    company: lead.company_name as string,
    contact: lead.contact_person as string | null,
    seller: context.profile.full_name || context.user.email || "",
    campaign: settings.name,
    calendarUrl: settings.calendar_url,
  };
  return {
    lead, settings,
    draft: {
      to: (lead.email as string | null) ?? "",
      subject: renderEmailTemplate(settings.email_subject || defaultEmailSubject, merge),
      body: renderEmailTemplate(settings.email_body || defaultEmailBody, merge),
      reply_to: settings.email_reply_to,
      can_send: emailProviderConfigured(),
    },
  } as const;
}

// The campaign's follow-up e-mail, filled in for this lead, so the seller can review it.
export async function GET(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { id } = await route.params;
  const loaded = await loadDraft(result.context, id);
  if ("response" in loaded) return loaded.response;
  return NextResponse.json({ data: loaded.draft });
}

export async function POST(request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const { id } = await route.params;
  const body = await readJson(request);
  const loaded = await loadDraft(context, id);
  if ("response" in loaded) return loaded.response;
  const to = typeof body?.to === "string" ? body.to.trim() : loaded.draft.to;
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 200) : loaded.draft.subject;
  const text = typeof body?.body === "string" ? body.body.slice(0, 10000) : loaded.draft.body;
  if (!isEmailAddress(to)) return apiError("Skriv en gyldig e-mailadresse til modtageren.");
  if (!subject || !text.trim()) return apiError("E-mailen skal have et emne og en tekst.");
  if (!emailProviderConfigured()) return apiError("Afsendelse af e-mail er ikke sat op på serveren endnu.", 503);
  try {
    await sendEmail({
      to, subject, text,
      fromName: loaded.settings.email_from_name || undefined,
      replyTo: loaded.settings.email_reply_to || undefined,
    });
  } catch (sendError) {
    return apiError(sendError instanceof Error ? sendError.message : "E-mailen kunne ikke sendes.", 502);
  }
  // Keep the address on the lead and log the e-mail in its history.
  if (!loaded.lead.email) await context.supabase.from("leads").update({ email: to }).eq("id", id);
  const { error: noteError } = await context.supabase.from("notes").insert({
    team_id: context.profile.team_id, lead_id: id, user_id: context.user.id,
    body: `E-mail sendt til ${to}: ${subject}`,
  });
  if (noteError) console.error("E-mail note failed", noteError.message);
  await writeAudit(context, "email_sent", "lead", id, { subject });
  return NextResponse.json({ data: { sent: true } });
}
