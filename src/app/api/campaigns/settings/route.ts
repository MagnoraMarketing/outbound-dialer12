import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";
import { emailProviderConfigured } from "@/lib/campaign-email";
import { siteUrl } from "@/lib/site-url";

// Admin overview of every campaign's calendar and e-mail settings.
export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan se kampagneindstillinger.", 403);
  const { data, error } = await context.supabase.from("campaigns")
    .select("id, name, created_at, partner_id, calendar_url, calendar_token, email_enabled, email_from_name, email_reply_to, email_subject, email_body")
    .eq("team_id", context.profile.team_id).order("created_at", { ascending: false });
  if (error) {
    console.error("Campaign settings query failed", error.code, error.message);
    if (error.code === "42703") return apiError("Kampagneindstillinger kræver, at den nyeste databasemigration er kørt.", 503);
    return apiError("Kampagnerne kunne ikke hentes.", 500);
  }
  const base = siteUrl();
  return NextResponse.json({
    email_configured: emailProviderConfigured(),
    data: (data ?? []).map(({ calendar_token: token, ...campaign }) => ({
      ...campaign,
      feed_url: `${base}/api/calendar/${token}.ics`,
    })),
  });
}
