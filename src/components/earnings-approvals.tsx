"use client";

import { BadgeCheck, CircleX, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { feedbackLabels, type FeedbackStatus } from "@/lib/feedback-labels";

type Decision = { status: "approved" | "rejected"; amount_dkk: number; decided_at: string } | null;
type EarningItem = {
  source_type: "meeting" | "sale" | "upsell"; source_id: string; user_id: string; seller_name: string; occurred_at: string;
  company_name: string | null; campaign_name: string; partner_status: FeedbackStatus | null; suggested_dkk: number; decision: Decision;
};

type FeeRow = { user_id: string; seller_name: string; gross: number; covered: number; own: number };
type SystemFee = { fee_dkk: number; month: FeeRow[] };
const dkk = (value: number) => `${value.toLocaleString("da-DK", { maximumFractionDigits: 2 })} DKK`;

async function earningsApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

// Admin queue: approving a meeting or sale is what makes it verified sales
// earnings (DKK) and releases the related game rewards.
export function EarningsApprovals() {
  const [items, setItems] = useState<EarningItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [type, setType] = useState<"all" | "meeting" | "sale" | "upsell">("all");
  const [query, setQuery] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [systemFee, setSystemFee] = useState<SystemFee | null>(null);
  const [feeInput, setFeeInput] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await earningsApi<{ data: EarningItem[]; system_fee: SystemFee }>("/api/admin/earnings");
      setItems(result.data);
      setSystemFee(result.system_fee);
      setFeeInput((current) => current || String(result.system_fee.fee_dkk));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Listen kunne ikke hentes.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(item: EarningItem, status: "approved" | "rejected") {
    const key = `${item.source_type}:${item.source_id}`;
    const amount = Number((amounts[key] ?? String(item.decision?.amount_dkk ?? item.suggested_dkk)).replace(",", "."));
    if (status === "approved" && (!Number.isFinite(amount) || amount < 0)) { setError("Skriv et gyldigt beløb i DKK."); return; }
    setBusyKey(key);
    setError("");
    try {
      await earningsApi("/api/admin/earnings", { method: "PUT", body: JSON.stringify({ source_type: item.source_type, source_id: item.source_id, status, amount_dkk: amount }) });
      setNotice(status === "approved" ? `Godkendt: ${amount.toLocaleString("da-DK")} DKK til ${item.seller_name}.` : "Afvist.");
      await load();
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : "Beslutningen kunne ikke gemmes.");
    } finally {
      setBusyKey("");
    }
  }

  async function saveFee() {
    const fee = Number(feeInput.replace(",", "."));
    if (!Number.isFinite(fee) || fee < 0) { setError("Skriv et gyldigt beløb i DKK."); return; }
    setBusyKey("fee");
    setError("");
    try {
      await earningsApi("/api/admin/earnings", { method: "PATCH", body: JSON.stringify({ seller_system_fee_dkk: fee }) });
      setNotice(`Systemdækningen er nu ${dkk(fee)} pr. sælger pr. måned.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Beløbet kunne ikke gemmes.");
    } finally {
      setBusyKey("");
    }
  }

  const visible = (items ?? []).filter((item) => (type === "all" || item.source_type === type)
    && (filter === "all" || (filter === "pending" ? !item.decision : item.decision?.status === filter))
    && (!query || `${item.seller_name} ${item.company_name ?? ""} ${item.campaign_name}`.toLocaleLowerCase("da-DK").includes(query.toLocaleLowerCase("da-DK"))));
  const pending = (items ?? []).filter((item) => !item.decision).length;

  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION · SENESTE 180 DAGE</span><h1>Godkend indtjening</h1>
      <p>Godkendte møder og salg bliver til verificeret salgsindtjening i DKK. Det tæller mod Magnora Market og udløser spilbelønninger.</p></div>
      <span className="secure-tag"><BadgeCheck size={15} /> {pending} afventer</span></div>
    {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role="status"><span>{error || notice}</span>
      <button aria-label="Luk besked" onClick={() => { setError(""); setNotice(""); }}><CircleX size={16} /></button></div>}
    <section className="panel ea-panel ea-fee">
      <div className="panel-heading"><div><span className="panel-eyebrow">SYSTEMDÆKNING · DENNE MÅNED</span><h2>Sælgernes systemdækning</h2>
        <p className="mg-fineprint">Hver sælger dækker systemet med de første {dkk(systemFee?.fee_dkk ?? 500)} af sin godkendte indtjening hver måned. Alt derover er sælgerens egen indtjening.</p></div></div>
      <form className="ea-fee-form" onSubmit={(event) => { event.preventDefault(); void saveFee(); }}>
        <label>Beløb pr. sælger pr. måned (DKK)<input className="ea-amount" inputMode="decimal" value={feeInput} onChange={(event) => setFeeInput(event.target.value)} /></label>
        <button className="button button-primary" disabled={busyKey === "fee"}>Gem beløb</button>
      </form>
      <div className="table-scroll"><table className="ea-table"><thead><tr><th>Sælger</th><th>Godkendt denne måned</th><th>Systemdækning</th><th>Sælgerens indtjening</th></tr></thead>
        <tbody>{(systemFee?.month ?? []).map((row) => <tr key={row.user_id}>
          <td>{row.seller_name}</td><td>{dkk(row.gross)}</td>
          <td>{dkk(row.covered)} / {dkk(systemFee?.fee_dkk ?? 0)}</td>
          <td><strong>{dkk(row.own)}</strong></td>
        </tr>)}
          {!systemFee?.month.length && <tr><td colSpan={4} className="fb-empty">{systemFee ? "Ingen godkendt indtjening endnu denne måned." : "Henter …"}</td></tr>}
        </tbody></table></div>
    </section>
    <section className="panel ea-panel">
      <div className="ea-toolbar">
        <div className="mg-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg sælger, virksomhed eller kampagne" aria-label="Søg" /></div>
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Status">
          <option value="pending">Afventer</option><option value="approved">Godkendt</option><option value="rejected">Afvist</option><option value="all">Alle</option></select>
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} aria-label="Type">
          <option value="all">Møder og salg</option><option value="meeting">Møder</option><option value="sale">Salg</option><option value="upsell">Mersalg</option></select>
      </div>
      <p className="mg-fineprint">Beløbet er foreslået ud fra provisionssatsen i sælgerens budget for kampagnen. Ret det, hvis den aftalte indtjening er en anden.</p>
      <div className="table-scroll"><table className="ea-table"><thead><tr><th>Dato</th><th>Type</th><th>Sælger</th><th>Virksomhed / kampagne</th><th>Partnerens status</th><th>DKK</th><th>Beslutning</th></tr></thead>
        <tbody>{visible.map((item) => {
          const key = `${item.source_type}:${item.source_id}`;
          return <tr key={key}>
            <td>{new Date(item.occurred_at).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })}</td>
            <td>{item.source_type === "meeting" ? "Møde" : item.source_type === "upsell" ? "Mersalg" : "Salg"}</td>
            <td>{item.seller_name}</td>
            <td><strong>{item.company_name ?? "Registreret salg"}</strong><small className="table-sub">{item.campaign_name || "—"}</small></td>
            <td>{item.partner_status ? <span className={`fb-badge fb-${item.partner_status}`}>{feedbackLabels[item.partner_status]}</span> : <span className="fb-muted">—</span>}</td>
            <td><input className="ea-amount" inputMode="decimal" aria-label="Beløb i DKK" value={amounts[key] ?? String(item.decision?.amount_dkk ?? item.suggested_dkk)}
              onChange={(event) => setAmounts({ ...amounts, [key]: event.target.value })} /></td>
            <td><div className="ea-actions">
              {item.decision && <span className={`fb-badge ${item.decision.status === "approved" ? "fb-good" : "fb-overdue"}`}>{item.decision.status === "approved" ? "Godkendt" : "Afvist"}</span>}
              <button className="button button-primary" disabled={busyKey === key} onClick={() => void decide(item, "approved")}>{item.decision?.status === "approved" ? "Opdatér" : "Godkend"}</button>
              {item.decision?.status !== "rejected" && <button className="button button-secondary" disabled={busyKey === key} onClick={() => void decide(item, "rejected")}>Afvis</button>}
            </div></td>
          </tr>;
        })}
          {!visible.length && <tr><td colSpan={7} className="fb-empty">{items ? "Intet at vise med de valgte filtre." : "Henter …"}</td></tr>}
        </tbody></table></div>
    </section>
  </div>;
}
