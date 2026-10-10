import { apiError, createSupabaseAdminClient } from "@/lib/http";
import { feedbackLabels, meetingTypeLabel, type FeedbackStatus } from "@/lib/feedback-labels";
import { siteUrl } from "@/lib/site-url";

type RouteContext = { params: Promise<{ token: string }> };
type MeetingRow = {
  id: string; meeting_at: string; meeting_type: string; notes: string; calendar_url: string | null; created_at: string;
  leads: { company_name: string; contact_person: string | null; phone: string; email: string | null; campaign_id: string | null } | null;
};

function icsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsDate(value: string | number) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
// Lines longer than 75 octets must be folded (RFC 5545 §3.1).
function fold(line: string) {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

// Read-only calendar feed of the meetings booked on one campaign. The secret token
// in the URL is the access check, like a Google Calendar "secret address".
export async function GET(_request: Request, route: RouteContext) {
  const { token } = await route.params;
  const id = token.replace(/\.ics$/i, "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("Kalenderen findes ikke.", 404);
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return apiError("Kalenderen er ikke tilgængelig.", 503);
  }
  const { data: campaign } = await admin.from("campaigns").select("id, team_id, name").eq("calendar_token", id).maybeSingle();
  if (!campaign) return apiError("Kalenderen findes ikke.", 404);
  const { data, error } = await admin.from("meetings")
    .select("id, meeting_at, meeting_type, notes, calendar_url, created_at, leads!inner(company_name, contact_person, phone, email, campaign_id)")
    .eq("team_id", campaign.team_id).eq("leads.campaign_id", campaign.id)
    .gte("meeting_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
    .order("meeting_at", { ascending: true }).limit(2000);
  if (error) {
    console.error("Calendar feed query failed", error.message);
    return apiError("Kalenderen kunne ikke hentes.", 500);
  }
  const rows = (data ?? []) as unknown as MeetingRow[];
  const { data: feedback } = rows.length
    ? await admin.from("meeting_feedback").select("meeting_id, status").eq("team_id", campaign.team_id)
      .in("meeting_id", rows.map((row) => row.id).slice(0, 300))
    : { data: [] };
  const statusByMeeting = new Map((feedback ?? []).map((item) => [item.meeting_id as string, item.status as FeedbackStatus]));
  const host = new URL(siteUrl()).host;
  const now = icsDate(Date.now());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nordcall//Kampagnekalender//DA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`Møder · ${campaign.name}`)}`, "X-WR-TIMEZONE:Europe/Copenhagen", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const row of rows) {
    const lead = row.leads;
    const status = statusByMeeting.get(row.id);
    const description = [
      lead?.contact_person ? `Kontaktperson: ${lead.contact_person}` : "",
      lead?.phone ? `Telefon: ${lead.phone}` : "",
      lead?.email ? `E-mail: ${lead.email}` : "",
      `Mødetype: ${meetingTypeLabel(row.meeting_type)}`,
      status ? `Status: ${feedbackLabels[status]}` : "",
      row.notes ? `\nNoter fra sælgeren:\n${row.notes}` : "",
      `\nGiv status på mødet: ${siteUrl()}/kunde`,
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${row.id}@${host}`,
      `DTSTAMP:${now}`,
      `CREATED:${icsDate(row.created_at)}`,
      `DTSTART:${icsDate(row.meeting_at)}`,
      `DTEND:${icsDate(Date.parse(row.meeting_at) + 60 * 60 * 1000)}`,
      `SUMMARY:${icsText(`Møde: ${lead?.company_name ?? "Virksomhed"}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      ...(row.calendar_url ? [`URL:${icsText(row.calendar_url)}`] : []),
      ...(row.meeting_type === "online" && row.calendar_url ? [`LOCATION:${icsText(row.calendar_url)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="nordcall-${campaign.id.slice(0, 8)}.ics"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
