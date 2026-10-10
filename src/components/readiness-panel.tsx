"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Check = { key: string; label: string; ok: boolean; required: boolean; fix: string };
type CampaignStatus = { id: string; name: string; leads: number; callable: number; caller_number: string | null; sellers: number };
type Readiness = { ready: boolean; checks: Check[]; campaigns: CampaignStatus[] };

// Admin checklist: everything that must be in place before a list can be imported and called.
export function ReadinessPanel({ onOpen }: { onOpen: (page: "import" | "numbers" | "team" | "dialer") => void }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/readiness", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Systemtjekket kunne ikke hentes.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Systemtjekket kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const problems = data?.checks.filter((check) => !check.ok) ?? [];
  const blocking = problems.filter((check) => check.required);
  return <section className="panel rd-panel">
    <div className="rd-head">
      <div><span className="panel-eyebrow">SYSTEMTJEK</span>
        <h2>{!data ? "Klar til at ringe?" : blocking.length ? `${blocking.length} ting mangler, før I kan ringe` : "Klar til at importere og ringe"}</h2></div>
      <button className="icon-button" onClick={() => void load()} aria-label="Tjek igen" disabled={loading}><RefreshCw size={15} className={loading ? "rd-spin" : ""} /></button>
    </div>
    {error && <p className="form-error">{error}</p>}
    {!data && !error && <span className="skeleton" />}
    {data && <>
      <ul className="rd-list">
        {problems.map((check) => <li key={check.key} className={check.required ? "rd-bad" : "rd-warn"}>
          {check.required ? <AlertTriangle size={15} /> : <CircleDashed size={15} />}
          <span><strong>{check.label}{check.required ? "" : " (valgfri)"}</strong><small>{check.fix}</small></span>
        </li>)}
        {!problems.length && <li className="rd-ok"><CheckCircle2 size={15} /><span><strong>Alt er sat op.</strong><small>Nøgler, database og telefoni svarer som de skal.</small></span></li>}
      </ul>
      {data.campaigns.length > 0 && <div className="rd-campaigns">
        <table><thead><tr><th>Kampagne</th><th>Leads klar</th><th>Udgående nummer</th><th>Sælgere</th></tr></thead>
          <tbody>{data.campaigns.map((campaign) => <tr key={campaign.id}>
            <td>{campaign.name}</td>
            <td>{campaign.callable ? <span className="rd-good">{campaign.callable.toLocaleString("da-DK")} af {campaign.leads.toLocaleString("da-DK")}</span>
              : <button className="text-button" onClick={() => onOpen("import")}>Importér leads</button>}</td>
            <td>{campaign.caller_number ?? <button className="text-button" onClick={() => onOpen("numbers")}>Vælg nummer</button>}</td>
            <td>{campaign.sellers || <button className="text-button" onClick={() => onOpen("team")} title="Administratorer kan altid ringe; sælgere skal tildeles kampagnen.">Tildel sælgere</button>}</td>
          </tr>)}</tbody></table>
      </div>}
      {!blocking.length && <button className="button button-primary rd-go" onClick={() => onOpen("dialer")}>Gå til Opkald</button>}
    </>}
  </section>;
}
