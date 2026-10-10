import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";
import { normalizeCallerNumber } from "@/lib/telephony/numbers";

type Check = { key: string; label: string; ok: boolean; required: boolean; fix: string };
type CampaignStatus = {
  id: string; name: string; leads: number; callable: number;
  caller_number: string | null; sellers: number;
};

// Database objects the import → call flow depends on, with the migration that adds them.
const schemaChecks: { table: string; columns: string; migration: string; label: string; required: boolean }[] = [
  { table: "campaigns", columns: "id, name, team_id", migration: "20261005020000_campaigns_and_dialpad.sql", label: "Kampagner", required: true },
  { table: "lead_lists", columns: "id, campaign_id", migration: "20261005020000_campaigns_and_dialpad.sql", label: "Leadlister", required: true },
  { table: "leads", columns: "id, campaign_id, lead_list_id", migration: "20261005040000_campaign_leads.sql", label: "Leads i kampagner", required: true },
  { table: "campaign_assignments", columns: "campaign_id, user_id", migration: "20261005030000_team_campaign_assignments.sql", label: "Sælgere på kampagner", required: true },
  { table: "telnyx_webrtc_credentials", columns: "user_id, credential_id", migration: "20261005070000_telnyx_webrtc_credentials.sql", label: "Headset-forbindelser", required: true },
  { table: "calls", columns: "id, recording_enabled, caller_number", migration: "20261010110000_campaign_phone_numbers.sql", label: "Opkaldslog", required: true },
  { table: "phone_numbers", columns: "id, number, is_default", migration: "20261010110000_campaign_phone_numbers.sql", label: "Udgående numre", required: true },
  { table: "profiles", columns: "id, access_mode, can_dial_manual", migration: "20261010120000_seller_access_modes.sql", label: "Sælgeradgang", required: true },
  { table: "sales_targets", columns: "id", migration: "20261005050000_budgets_and_team_messages.sql", label: "Budgetter", required: false },
  { table: "team_messages", columns: "id", migration: "20261005050000_budgets_and_team_messages.sql", label: "Beskeder", required: false },
  { table: "campaigns", columns: "calendar_url, email_enabled", migration: "20261011090000_campaign_calendar_and_email.sql", label: "Kalender og e-mail pr. kampagne", required: false },
];

// One place that answers "what is still missing before we can import a list and call?"
export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  if (context.profile.role !== "admin") return apiError("Kun administratorer kan se systemtjekket.", 403);
  const teamId = context.profile.team_id;
  const checks: Check[] = [];
  const env = (name: string) => Boolean(process.env[name]?.trim());

  checks.push({ key: "env_service", label: "Serveradgang til databasen", ok: env("SUPABASE_SERVICE_ROLE_KEY"), required: true,
    fix: "Tilføj SUPABASE_SERVICE_ROLE_KEY i Vercel → Settings → Environment Variables og redeploy." });
  checks.push({ key: "env_telnyx", label: "Telnyx API-nøgle", ok: env("TELNYX_API_KEY"), required: true,
    fix: "Tilføj TELNYX_API_KEY i Vercel og redeploy." });
  checks.push({ key: "env_webrtc", label: "Telnyx headset-forbindelse (WebRTC)", ok: env("TELNYX_WEBRTC_CONNECTION_ID"), required: true,
    fix: "Tilføj TELNYX_WEBRTC_CONNECTION_ID (id på en Credential Connection i Telnyx) i Vercel og redeploy." });
  checks.push({ key: "env_webhook", label: "Telnyx webhook-nøgle", ok: env("TELNYX_PUBLIC_KEY"), required: false,
    fix: "Tilføj TELNYX_PUBLIC_KEY i Vercel, så opkaldsstatus og varighed bliver opdateret." });
  checks.push({ key: "env_email", label: "E-mail efter samtale (Resend)", ok: env("RESEND_API_KEY") && env("EMAIL_FROM"), required: false,
    fix: "Tilføj RESEND_API_KEY og EMAIL_FROM i Vercel. Uden dem åbnes mailen i sælgerens eget mailprogram." });

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ready: false, checks, campaigns: [] });
  }

  for (const schema of schemaChecks) {
    const { error } = await admin.from(schema.table).select(schema.columns).limit(1);
    checks.push({
      key: `db_${schema.table}_${schema.columns}`, label: `Database: ${schema.label}`, ok: !error, required: schema.required,
      fix: `Kør migrationen supabase/migrations/${schema.migration} i Supabase → SQL Editor.`,
    });
  }

  if (env("TELNYX_API_KEY") && env("TELNYX_WEBRTC_CONNECTION_ID")) {
    let ok = false;
    try {
      const response = await fetch(`https://api.telnyx.com/v2/credential_connections/${encodeURIComponent(process.env.TELNYX_WEBRTC_CONNECTION_ID!.trim())}`, {
        headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY!.trim()}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      ok = response.ok;
    } catch { /* reported as not ok */ }
    checks.push({ key: "telnyx_connection", label: "Telnyx accepterer nøgle og headset-forbindelse", ok, required: true,
      fix: "Kontrollér i Telnyx, at TELNYX_API_KEY er gyldig, og at TELNYX_WEBRTC_CONNECTION_ID er id'et på en Credential Connection med en Outbound Voice Profile." });
  }

  // Per campaign: callable leads, caller number and sellers.
  const campaigns: CampaignStatus[] = [];
  const { data: campaignRows } = await admin.from("campaigns").select("id, name").eq("team_id", teamId).order("created_at", { ascending: false }).limit(50);
  const { data: defaultNumber } = await admin.from("phone_numbers").select("number").eq("team_id", teamId).eq("is_default", true).maybeSingle();
  const envNumber = normalizeCallerNumber(process.env.TELNYX_PHONE_NUMBER);
  for (const campaign of campaignRows ?? []) {
    const nowIso = new Date().toISOString();
    const [total, callable, linked, sellers] = await Promise.all([
      admin.from("leads").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("campaign_id", campaign.id).is("deleted_at", null),
      admin.from("leads").select("id", { count: "exact", head: true })
        .eq("team_id", teamId).eq("campaign_id", campaign.id).is("deleted_at", null)
        .not("status", "in", '("do_not_call","wrong_number","converted")')
        .or(`next_follow_up_at.is.null,next_follow_up_at.lte.${nowIso}`),
      admin.from("campaigns").select("phone_numbers(number)").eq("id", campaign.id).maybeSingle(),
      admin.from("campaign_assignments").select("user_id", { count: "exact", head: true }).eq("campaign_id", campaign.id),
    ]);
    const link = linked.data?.phone_numbers as unknown as { number: string } | { number: string }[] | null;
    const campaignNumber = Array.isArray(link) ? link[0]?.number : link?.number;
    campaigns.push({
      id: campaign.id as string, name: campaign.name as string, leads: total.count ?? 0, callable: callable.count ?? 0,
      caller_number: campaignNumber ?? defaultNumber?.number ?? envNumber ?? null,
      sellers: sellers.count ?? 0,
    });
  }
  checks.push({ key: "campaign_exists", label: "Mindst én kampagne", ok: campaigns.length > 0, required: true,
    fix: "Opret en kampagne under Importer leads eller Samarbejdspartnere." });
  checks.push({ key: "campaign_leads", label: "Leads klar til opkald", ok: campaigns.some((campaign) => campaign.callable > 0), required: true,
    fix: "Importér en CSV- eller Excel-fil med telefonnumre til en kampagne under Importer leads." });
  checks.push({ key: "caller_number", label: "Udgående telefonnummer", ok: campaigns.some((campaign) => campaign.caller_number) || Boolean(defaultNumber || envNumber), required: true,
    fix: "Gå til Telefonnumre og vælg et standardnummer eller tildel et nummer til kampagnen." });

  const ready = checks.every((check) => check.ok || !check.required);
  return NextResponse.json({ ready, checks, campaigns });
}
