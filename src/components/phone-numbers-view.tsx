"use client";

import { AlertTriangle, CheckCircle2, Phone, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type TeamNumber = { id: string; number: string; provider_id: string | null; label: string; is_default: boolean };
type CampaignRow = { id: string; name: string; phone_number_id: string | null };
type ProviderNumber = { id: string; phone_number: string; status: string; connection_id: string | null; connection_name: string | null };
type NumberData = { data: TeamNumber[]; campaigns: CampaignRow[]; provider: { numbers: ProviderNumber[]; error: string | null }; env_fallback: string | null };

async function numbersApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

// Admin-only: caller numbers come from the telephony account and are assigned
// per campaign. Sellers always call from the number assigned here.
export function PhoneNumbersView() {
  const [state, setState] = useState<NumberData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await numbersApi<NumberData>("/api/admin/phone-numbers"));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Telefonnumrene kunne ikke hentes.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Handlingen mislykkedes.");
    } finally {
      setBusy(false);
    }
  }

  const added = new Set((state?.data ?? []).map((number) => number.number));
  const fallback = state?.data.find((number) => number.is_default)?.number ?? state?.env_fallback ?? null;
  const uncovered = (state?.campaigns ?? []).filter((campaign) => !campaign.phone_number_id).length;

  function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void act(() => numbersApi("/api/admin/phone-numbers", { method: "POST", body: JSON.stringify({ number: form.get("number"), label: form.get("label") }) }), "Nummeret er tilføjet.")
      .then(() => formElement.reset());
  }

  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Telefonnumre</h1>
      <p>Hent numre fra telefonikontoen, og tildel dem til kampagnerne. Sælgerne ringer altid fra det nummer, der er tildelt her.</p></div>
      <button className="button button-secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /> Opdatér</button></div>
    {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role="status"><span>{error || notice}</span>
      <button aria-label="Luk besked" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

    {state && !fallback && uncovered > 0 && <div className="panel pn-warning"><AlertTriangle size={17} />
      <p><strong>{uncovered} kampagner har intet nummer, og der er intet standardnummer.</strong> Opkald i dem bliver afvist, indtil du tildeler et nummer eller vælger et standardnummer.</p></div>}

    <div className="pn-grid">
      <section className="panel pn-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">TEAMETS NUMRE</span><h2>Udgående numre</h2></div><Phone size={16} className="heading-muted" /></div>
        {state?.data.length ? <ul className="pn-list">{state.data.map((number) => <li key={number.id}>
          <span><strong>{number.number}</strong><small>{number.label || "Uden navn"}{number.provider_id ? " · fra telefonikontoen" : " · tilføjet manuelt"}</small></span>
          {number.is_default ? <span className="fb-badge fb-good"><Star size={11} /> Standard</span>
            : <button className="text-button" disabled={busy} onClick={() => void act(() => numbersApi("/api/admin/phone-numbers", { method: "PATCH", body: JSON.stringify({ id: number.id, is_default: true }) }), `${number.number} er nu standardnummer.`)}>Gør til standard</button>}
          <button className="icon-button" aria-label={`Fjern ${number.number}`} disabled={busy} onClick={() => {
            if (window.confirm(`Fjern ${number.number}? Kampagner med nummeret bruger derefter standardnummeret.`)) {
              void act(() => numbersApi(`/api/admin/phone-numbers?id=${number.id}`, { method: "DELETE" }), "Nummeret er fjernet.");
            }
          }}><Trash2 size={15} /></button>
        </li>)}</ul> : <p className="fb-muted">{state ? "Ingen numre endnu. Tilføj et nummer fra telefonikontoen nedenfor." : "Henter …"}</p>}
        {!state?.data.some((number) => number.is_default) && state?.env_fallback && <p className="fb-muted">Uden standardnummer bruges serverens reservenummer {state.env_fallback}.</p>}
        <form className="pn-manual" onSubmit={addManual}>
          <strong>Tilføj nummer manuelt</strong>
          <input name="number" required placeholder="+4512345678" aria-label="Telefonnummer" />
          <input name="label" maxLength={80} placeholder="Navn (valgfrit)" aria-label="Navn" />
          <button className="button button-secondary" disabled={busy}><Plus size={14} /> Tilføj</button>
        </form>
      </section>

      <section className="panel pn-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">TELEFONIKONTO</span><h2>Numre på kontoen</h2></div></div>
        {state?.provider.error ? <p className="form-error">{state.provider.error}</p>
          : state?.provider.numbers.length ? <ul className="pn-list">{state.provider.numbers.map((number) => {
            const isAdded = added.has(number.phone_number);
            return <li key={number.id}>
              <span><strong>{number.phone_number}</strong><small>{number.status || "ukendt status"}{number.connection_name ? ` · ${number.connection_name}` : ""}</small></span>
              {isAdded ? <span className="fb-badge fb-good"><CheckCircle2 size={11} /> Tilføjet</span>
                : <button className="button button-primary" disabled={busy || number.status !== "active"} onClick={() => void act(() => numbersApi("/api/admin/phone-numbers", { method: "POST", body: JSON.stringify({ number: number.phone_number, provider_id: number.id }) }), `${number.phone_number} er tilføjet.`)}>Tilføj</button>}
            </li>;
          })}</ul> : <p className="fb-muted">{state ? "Der er ingen numre på telefonikontoen. Køb et nummer hos udbyderen, og tryk Opdatér." : "Henter …"}</p>}
      </section>
    </div>

    <section className="panel pn-panel pn-campaigns">
      <div className="panel-heading"><div><span className="panel-eyebrow">KAMPAGNER</span><h2>Nummer pr. kampagne</h2></div></div>
      {state?.campaigns.length ? <div className="table-scroll"><table className="ea-table"><thead><tr><th>Kampagne</th><th>Udgående nummer</th></tr></thead><tbody>
        {state.campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong></td><td>
          <select value={campaign.phone_number_id ?? ""} disabled={busy} aria-label={`Nummer for ${campaign.name}`}
            onChange={(event) => void act(() => numbersApi("/api/admin/phone-numbers", { method: "PATCH", body: JSON.stringify({ campaign_id: campaign.id, phone_number_id: event.target.value || null }) }), `Nummeret for ${campaign.name} er gemt.`)}>
            <option value="">{fallback ? `Standardnummer (${fallback})` : "Intet nummer – vælg et"}</option>
            {state.data.map((number) => <option key={number.id} value={number.id}>{number.number}{number.label ? ` · ${number.label}` : ""}</option>)}
          </select>
        </td></tr>)}
      </tbody></table></div> : <p className="fb-muted">{state ? "Opret en kampagne under Importer leads først." : "Henter …"}</p>}
      <p className="fb-muted">Opkald fra Dialpad uden virksomhed bruger standardnummeret.</p>
    </section>
  </div>;
}
