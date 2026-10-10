"use client";

import { CreditCard, ExternalLink, Timer } from "lucide-react";
import { useEffect, useState } from "react";

type Subscription = {
  plan: string; label: string; status: string; included_minutes: number; trial_ends_at: string | null;
  current_period_start: string; current_period_end: string | null;
};
type Data = { subscription: Subscription | null; usage: { used_minutes: number; period_start: string; calls: number }; manage_url: string };

const STATUS_LABELS: Record<string, string> = {
  trialing: "Prøveperiode", active: "Aktiv", past_due: "Betaling mangler", canceled: "Opsagt", expired: "Udløbet",
};
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "—";

// Admin-only: the team's Outbound plan and this period's talk minutes.
export function SubscriptionView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/subscription").then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Abonnementet kunne ikke hentes.");
      setData(body);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Abonnementet kunne ikke hentes."));
  }, []);

  const sub = data?.subscription;
  const internal = sub?.plan === "internal";
  const used = data?.usage.used_minutes ?? 0;
  const included = sub?.included_minutes ?? 0;
  const percent = included > 0 ? Math.min(100, Math.round(used / included * 100)) : 0;
  const over = !internal && included > 0 && used > included;

  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Abonnement</h1>
      <p>Dit Outbound-abonnement og teamets taleminutter i den nuværende periode.</p></div><CreditCard size={21} className="heading-muted" /></div>
    {error && <div className="toast toast-error" role="status"><span>{error}</span></div>}
    {!data && !error && <div className="panel empty-panel"><p>Henter abonnement …</p></div>}
    {data && <div className="sub-grid">
      <section className="panel sub-card">
        <span className="panel-eyebrow">PAKKE</span>
        <h2>{sub ? sub.label : "Intet abonnement"}</h2>
        {sub && <span className={`fb-badge ${sub.status === "active" || sub.status === "trialing" ? "fb-good" : "fb-overdue"}`}>{STATUS_LABELS[sub.status] ?? sub.status}</span>}
        <dl className="sub-lines">
          {sub?.plan === "trial" && <div><dt>Prøven slutter</dt><dd>{date(sub.trial_ends_at)}</dd></div>}
          {sub && !internal && <div><dt>Periode</dt><dd>{date(sub.current_period_start)} – {date(sub.current_period_end)}</dd></div>}
          {sub && !internal && <div><dt>Minutter inkluderet</dt><dd>{included.toLocaleString("da-DK")}</dd></div>}
        </dl>
        {!internal && <a className="button button-secondary" href={data.manage_url} target="_blank" rel="noreferrer">
          {sub && sub.plan !== "trial" ? "Skift eller opsig pakke" : "Vælg pakke"} <ExternalLink size={14} /></a>}
        {!internal && <p className="fb-muted">Pakker: 1.000 min. for 500 kr./md. eller 2.000 min. for 800 kr./md. Prøv gratis med 10 min. i 7 dage.</p>}
      </section>
      <section className="panel sub-card">
        <span className="panel-eyebrow">FORBRUG</span>
        <h2><Timer size={18} /> {used.toLocaleString("da-DK")} {internal || !included ? "minutter" : `/ ${included.toLocaleString("da-DK")} minutter`}</h2>
        {!internal && included > 0 && <div className="budget-progress-track"><i style={{ width: `${percent}%` }} /></div>}
        <p className="fb-muted">{data.usage.calls.toLocaleString("da-DK")} opkald siden {date(data.usage.period_start)}. Hvert opkald tælles i påbegyndte minutter.</p>
        {over && <p className="fb-muted">Pakkens minutter er brugt. Teamet kan stadig ringe – overvej den større pakke.</p>}
      </section>
    </div>}
  </div>;
}
