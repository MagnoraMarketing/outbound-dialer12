"use client";

import { CalendarDays, Check, Copy, Mail } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { defaultEmailBody, defaultEmailSubject, emailPlaceholders } from "@/lib/campaign-email";

type CampaignSettings = {
  id: string; name: string; partner_id: string | null; calendar_url: string | null; feed_url: string;
  email_enabled: boolean; email_from_name: string; email_reply_to: string; email_subject: string; email_body: string;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: options?.body ? { "Content-Type": "application/json" } : undefined });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

// Admin page: the booking calendar and the follow-up e-mail for each campaign.
export function CampaignsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignSettings[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request<{ data: CampaignSettings[]; email_configured: boolean }>("/api/campaigns/settings");
      setCampaigns(result.data);
      setEmailConfigured(result.email_configured);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kampagnerne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Kampagner</h1>
      <p>Vælg kalender og opfølgningsmail for hver kampagne. Møder booket på kampagnen lander i kampagnens kalender, hvor kunden kan følge dem.</p></div></div>
    {error && <p className="form-error">{error}</p>}
    {!emailConfigured && <div className="panel cs-notice"><Mail size={16} /><p>E-mails kan skrives og forhåndsvises, men serveren mangler <code>RESEND_API_KEY</code> og <code>EMAIL_FROM</code>, før de kan sendes. Indtil da åbner sælgeren mailen i sit eget mailprogram.</p></div>}
    {loading && !campaigns.length ? <div className="panel cs-card"><span className="skeleton" /></div> : null}
    {!loading && !campaigns.length && !error && <div className="panel cs-card"><p className="fb-muted">Ingen kampagner endnu. Opret en under Importer leads eller Samarbejdspartnere.</p></div>}
    <div className="cs-list">{campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign}
      open={openId === campaign.id} onToggle={() => setOpenId(openId === campaign.id ? null : campaign.id)}
      onSaved={(saved) => { setCampaigns((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved } : item)); onNotice("Kampagnen er gemt."); }} />)}</div>
  </div>;
}

function CampaignCard({ campaign, open, onToggle, onSaved }: {
  campaign: CampaignSettings; open: boolean; onToggle: () => void; onSaved: (saved: Partial<CampaignSettings> & { id: string }) => void;
}) {
  const [form, setForm] = useState(() => ({
    calendar_url: campaign.calendar_url ?? "",
    email_enabled: campaign.email_enabled,
    email_from_name: campaign.email_from_name,
    email_reply_to: campaign.email_reply_to,
    email_subject: campaign.email_subject || defaultEmailSubject,
    email_body: campaign.email_body || defaultEmailBody,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await request<{ data: CampaignSettings }>(`/api/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify(form) });
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kampagnen kunne ikke gemmes.");
    } finally {
      setBusy(false);
    }
  }

  async function copyFeed() {
    try {
      await navigator.clipboard.writeText(campaign.feed_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the field can still be selected */ }
  }

  return <section className="panel cs-card">
    <button className="cs-head" onClick={onToggle} aria-expanded={open}>
      <strong>{campaign.name}</strong>
      <span className="cs-badges">
        <span className={`cs-badge ${campaign.calendar_url ? "cs-on" : ""}`}><CalendarDays size={12} /> {campaign.calendar_url ? "Kalender valgt" : "Ingen kalender"}</span>
        <span className={`cs-badge ${campaign.email_enabled ? "cs-on" : ""}`}><Mail size={12} /> {campaign.email_enabled ? "E-mail slået til" : "E-mail fra"}</span>
      </span>
    </button>
    {open && <form className="cs-form" onSubmit={save}>
      <fieldset><legend><CalendarDays size={14} /> Kalender</legend>
        <label>Bookingkalender (link)<input type="url" value={form.calendar_url} onChange={(event) => setForm({ ...form, calendar_url: event.target.value })} placeholder="https://cal.com/kunde/møde eller Google/Outlook-bookingside" />
          <small>Sælgerne åbner denne kalender, når de booker et møde på kampagnen, og linket gemmes på mødet.</small></label>
        <label>Kampagnens kalenderfeed (til kunden)<span className="cs-copy"><input readOnly value={campaign.feed_url} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="button button-secondary button-small" onClick={() => void copyFeed()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Kopieret" : "Kopiér"}</button></span>
          <small>Alle møder på kampagnen. Kunden kan abonnere på linket i Google Kalender eller Outlook og ser det også i kundeportalen.</small></label>
      </fieldset>
      <fieldset><legend><Mail size={14} /> E-mail efter samtale</legend>
        <label className="cs-toggle"><input type="checkbox" checked={form.email_enabled} onChange={(event) => setForm({ ...form, email_enabled: event.target.checked })} /> Sælgerne kan sende denne e-mail til leadet efter samtalen</label>
        <div className="cs-grid">
          <label>Afsendernavn<input maxLength={120} value={form.email_from_name} onChange={(event) => setForm({ ...form, email_from_name: event.target.value })} placeholder="F.eks. kundens firmanavn" /></label>
          <label>Svar-til e-mail<input type="email" maxLength={200} value={form.email_reply_to} onChange={(event) => setForm({ ...form, email_reply_to: event.target.value })} placeholder="salg@kunde.dk" /></label>
        </div>
        <label>Emne<input maxLength={200} value={form.email_subject} onChange={(event) => setForm({ ...form, email_subject: event.target.value })} /></label>
        <label>Tekst<textarea rows={8} maxLength={10000} value={form.email_body} onChange={(event) => setForm({ ...form, email_body: event.target.value })} /></label>
        <small className="cs-help">Flettefelter: {emailPlaceholders.map((item) => <code key={item}>{item}</code>)}</small>
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      <div className="cs-actions"><button className="button button-primary" disabled={busy}>{busy ? "Gemmer …" : "Gem kampagne"}</button></div>
    </form>}
  </section>;
}
