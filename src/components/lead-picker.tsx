"use client";

import { useEffect, useState } from "react";

export type LeadPick = {
  leadId: string | null; companyName: string; phone: string; campaignId: string; campaignName?: string;
};
type LeadOption = { id: string; company_name: string; phone: string; city: string | null; campaign_id: string | null };
type CampaignOption = { id: string; name: string };

export const emptyLeadPick: LeadPick = { leadId: null, companyName: "", phone: "", campaignId: "" };

// Resolves a pick to a lead id, creating the company first when it was typed in by hand.
export async function ensureLead(pick: LeadPick) {
  if (pick.leadId) return pick.leadId;
  const name = pick.companyName.trim();
  if (name.length < 2) throw new Error("Skriv virksomhedens navn.");
  // A typed name that matches an existing company uses that company instead of a duplicate.
  const search = await fetch(`/api/leads?q=${encodeURIComponent(name)}`).then((response) => response.json()).catch(() => null);
  const existing = ((search?.data ?? []) as LeadOption[])
    .find((option) => option.company_name.toLocaleLowerCase("da-DK") === name.toLocaleLowerCase("da-DK"));
  if (existing) return existing.id;
  if (!pick.phone.trim()) throw new Error("Skriv et telefonnummer til den nye virksomhed.");
  if (!pick.campaignId) throw new Error("Vælg en kampagne til den nye virksomhed.");
  const response = await fetch("/api/leads", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: name, phone: pick.phone, campaign_id: pick.campaignId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Virksomheden kunne ikke oprettes.");
  return body.data.id as string;
}

// A company field you can type in: it suggests matching companies and lets you add a new one.
export function LeadPicker({ value, onChange }: { value: LeadPick; onChange: (pick: LeadPick) => void }) {
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const query = value.leadId ? "" : value.companyName.trim();

  useEffect(() => {
    if (query.length < 2) { setOptions([]); return; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void fetch(`/api/leads?q=${encodeURIComponent(query)}`).then((response) => response.json())
        .then((body) => { if (alive) setOptions(((body?.data ?? []) as LeadOption[]).slice(0, 8)); })
        .catch(() => { if (alive) setOptions([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    if (value.leadId || campaigns.length || query.length < 2) return;
    void fetch("/api/campaigns").then((response) => response.json())
      .then((body) => setCampaigns((body?.data ?? []) as CampaignOption[])).catch(() => undefined);
  }, [value.leadId, campaigns.length, query.length]);

  if (value.leadId) {
    return <div className="lead-picker">
      <span className="lead-picker-label">Virksomhed</span>
      <div className="lead-picker-chosen"><strong>{value.companyName}</strong>{value.phone && <small>{value.phone}</small>}
        <button type="button" className="text-button" onClick={() => onChange({ ...emptyLeadPick, companyName: value.companyName })}>Skift</button></div>
    </div>;
  }

  const exact = options.some((option) => option.company_name.toLocaleLowerCase("da-DK") === query.toLocaleLowerCase("da-DK"));
  return <div className="lead-picker">
    <label>Virksomhed<input required value={value.companyName} autoComplete="off" maxLength={200}
      onChange={(event) => onChange({ ...value, companyName: event.target.value })} placeholder="Skriv firmanavn …" /></label>
    {query.length >= 2 && <div className="lead-picker-options" role="listbox">
      {options.map((option) => <button type="button" role="option" aria-selected={false} key={option.id}
        onClick={() => onChange({ leadId: option.id, companyName: option.company_name, phone: option.phone, campaignId: option.campaign_id ?? "" })}>
        <strong>{option.company_name}</strong><small>{option.phone}{option.city ? ` · ${option.city}` : ""}</small>
      </button>)}
      {searching && !options.length && <span className="lead-picker-hint">Søger …</span>}
      {!searching && !options.length && <span className="lead-picker-hint">Ingen virksomhed fundet – opret den nedenfor.</span>}
    </div>}
    {query.length >= 2 && !exact && <div className="lead-picker-new">
      <span className="lead-picker-hint">Ny virksomhed: <strong>{query}</strong></span>
      <label>Telefonnummer<input inputMode="tel" value={value.phone} onChange={(event) => onChange({ ...value, phone: event.target.value })} placeholder="+45 12 34 56 78" /></label>
      <label>Kampagne<select value={value.campaignId} onChange={(event) => onChange({ ...value, campaignId: event.target.value })}>
        <option value="">Vælg kampagne …</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
    </div>}
  </div>;
}
