export type CampaignEmailSettings = {
  email_enabled: boolean; email_from_name: string; email_reply_to: string; email_subject: string; email_body: string;
  calendar_url: string | null; name: string;
};

export type EmailMergeData = {
  company: string; contact: string | null; seller: string; campaign: string; calendarUrl: string | null;
};

export const emailPlaceholders = ["{firma}", "{kontaktperson}", "{sælger}", "{kampagne}", "{kalenderlink}"];

export const defaultEmailSubject = "Tak for snakken, {kontaktperson}";
export const defaultEmailBody = "Hej {kontaktperson}\n\nTak for en god snak i dag. Som lovet sender jeg her en kort opfølgning.\n\nDu kan booke et tidspunkt, der passer dig, her: {kalenderlink}\n\nVenlig hilsen\n{sælger}";

export function renderEmailTemplate(template: string, data: EmailMergeData) {
  const contact = data.contact?.trim() || "";
  return template
    .replaceAll("{firma}", data.company)
    .replaceAll("{kontaktperson}", contact || data.company)
    .replaceAll("{sælger}", data.seller)
    .replaceAll("{kampagne}", data.campaign)
    .replaceAll("{kalenderlink}", data.calendarUrl || "")
    .replace(/[ \t]+\n/g, "\n");
}

export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export function emailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// Sends through Resend (https://resend.com). EMAIL_FROM must be on a verified domain,
// e.g. "Nordcall <noreply@ditdomæne.dk>". The campaign can override the display name.
export async function sendEmail(input: { to: string; subject: string; text: string; fromName?: string; replyTo?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("E-mail er ikke sat op på serveren.");
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const fromName = input.fromName?.replace(/[<>"\r\n]/g, "").trim();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${address}>` : from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("E-mail send failed", response.status, detail.slice(0, 300));
    throw new Error("E-mailen kunne ikke sendes. Prøv igen om lidt.");
  }
}
