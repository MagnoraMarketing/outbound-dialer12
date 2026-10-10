"use client";

import { ArrowRight, Building2, KeyRound, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";

export type PartnerLogin = { user_id: string; full_name: string; email: string; created_at: string };
export type Partner = {
  id: string; name: string; contact_name: string; contact_email: string; contact_phone: string; created_at: string;
  campaign_ids: string[]; users: PartnerLogin[];
};
export type PartnerCampaign = { id: string; name: string; partner_id: string | null };
export type PartnerData = { data: Partner[]; campaigns: PartnerCampaign[] };

type Actions = {
  onCreatePartner: (input: { name: string; contact_name: string; contact_email: string; contact_phone: string; campaign_name?: string }) => Promise<void>;
  onCreateCampaign: (partnerId: string, name: string) => Promise<void>;
  onUploadLeads: (campaignId: string) => void;
  onUpdatePartner: (input: { id: string; name?: string; contact_name?: string; contact_email?: string; contact_phone?: string; campaign_ids?: string[] }) => Promise<void>;
  onDeletePartner: (id: string) => Promise<void>;
  onCreateLogin: (input: { partner_id: string; full_name: string; email: string; password: string }) => Promise<void>;
  onDeleteLogin: (userId: string) => Promise<void>;
};

export function PartnersView({ partners, campaigns, loading, ...actions }: { partners: Partner[]; campaigns: PartnerCampaign[]; loading: boolean } & Actions) {
  const [creating, setCreating] = useState(false);
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Samarbejdspartnere</h1><p>Opret partnere, tilknyt deres kampagner, og giv dem login til partnerportalen på /kunde.</p></div>
      <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={16} /> Opret samarbejdspartner</button></div>
    {!partners.length && <div className="panel pt-empty">{loading ? "Henter samarbejdspartnere …" : <>
      <Building2 size={22} /><strong>Ingen samarbejdspartnere endnu</strong>
      <p>Opret en partner, tilknyt kampagner, og opret et login. Partneren ser derefter alle møder, der bookes på sine kampagner.</p>
    </>}</div>}
    <div className="pt-list">{partners.map((partner) => <PartnerCard key={partner.id} partner={partner} campaigns={campaigns} {...actions} />)}</div>
    {creating && <PartnerDialog onClose={() => setCreating(false)} onSave={actions.onCreatePartner} />}
  </div>;
}

function PartnerCard({ partner, campaigns, onUpdatePartner, onDeletePartner, onCreateLogin, onDeleteLogin, onCreateCampaign, onUploadLeads }: { partner: Partner; campaigns: PartnerCampaign[] } & Actions) {
  const [newCampaign, setNewCampaign] = useState("");
  const [editingCampaigns, setEditingCampaigns] = useState<string[] | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [addingLogin, setAddingLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = campaigns.filter((campaign) => partner.campaign_ids.includes(campaign.id));

  async function saveCampaigns() {
    if (!editingCampaigns) return;
    setBusy(true);
    try {
      await onUpdatePartner({ id: partner.id, campaign_ids: editingCampaigns });
      setEditingCampaigns(null);
    } catch {
      // The workspace shows the error.
    } finally {
      setBusy(false);
    }
  }

  return <article className="panel pt-card">
    <header className="pt-card-head">
      <span className="pt-avatar"><Building2 size={17} /></span>
      <div className="pt-card-title"><h2>{partner.name}</h2>
        <small>{[partner.contact_name, partner.contact_email, partner.contact_phone].filter(Boolean).join(" · ") || "Ingen kontaktoplysninger"}</small></div>
      <div className="pt-card-actions">
        <button className="button button-secondary" onClick={() => setEditingDetails(true)}>Rediger</button>
        <button className="icon-button" aria-label={`Slet ${partner.name}`} onClick={() => {
          if (window.confirm(`Slet ${partner.name}? Partnerens logins slettes. Kampagner og møder bevares.`)) void onDeletePartner(partner.id).catch(() => undefined);
        }}><Trash2 size={15} /></button>
      </div>
    </header>

    <section className="pt-section">
      <div className="pt-section-head"><span className="panel-eyebrow">KAMPAGNER · {own.length}</span>
        {!editingCampaigns && <button className="text-button" onClick={() => setEditingCampaigns(partner.campaign_ids)}>Vælg kampagner</button>}</div>
      {editingCampaigns ? <div className="pt-edit">
        {!campaigns.length ? <p className="fb-muted">Ingen kampagner endnu. Opret en direkte på partneren.</p> : <div className="fb-campaign-checks">{campaigns.map((campaign) => {
          const otherPartner = campaign.partner_id && campaign.partner_id !== partner.id;
          return <label key={campaign.id} className="fb-check" title={otherPartner ? "Tilhører en anden partner – flyttes hertil, hvis du vælger den" : undefined}>
            <input type="checkbox" checked={editingCampaigns.includes(campaign.id)}
              onChange={(event) => setEditingCampaigns(event.target.checked ? [...editingCampaigns, campaign.id] : editingCampaigns.filter((id) => id !== campaign.id))} />
            {campaign.name}{otherPartner && <small className="pt-other"> (anden partner)</small>}
          </label>;
        })}</div>}
        <div className="pt-edit-actions"><button className="button button-secondary" onClick={() => setEditingCampaigns(null)}>Annuller</button>
          <button className="button button-primary" disabled={busy} onClick={() => void saveCampaigns()}>{busy ? "Gemmer …" : "Gem kampagner"}</button></div>
      </div> : <>
        <div className="pt-campaigns">{own.map((campaign) => <div key={campaign.id} className="pt-campaign-row">
          <span className="pt-chip">{campaign.name}</span>
          <button className="text-button" onClick={() => onUploadLeads(campaign.id)}><Upload size={13} /> Upload leads</button>
        </div>)}
          {!own.length && <span className="fb-muted">Ingen kampagner endnu. Opret en nedenfor, og upload leads til den.</span>}</div>
        <form className="pt-new-campaign" onSubmit={(event) => {
          event.preventDefault();
          if (newCampaign.trim().length < 2) return;
          setBusy(true);
          void onCreateCampaign(partner.id, newCampaign.trim()).then(() => setNewCampaign("")).catch(() => undefined).finally(() => setBusy(false));
        }}>
          <input value={newCampaign} onChange={(event) => setNewCampaign(event.target.value)} maxLength={120} placeholder="Ny kampagne til partneren" aria-label="Ny kampagnes navn" />
          <button className="button button-secondary button-small" disabled={busy || newCampaign.trim().length < 2}><Plus size={14} /> Opret kampagne</button>
        </form>
      </>}
    </section>

    <section className="pt-section">
      <div className="pt-section-head"><span className="panel-eyebrow">LOGINS TIL PARTNERPORTALEN · {partner.users.length}</span>
        <button className="text-button" onClick={() => setAddingLogin(true)}><KeyRound size={13} /> Opret login</button></div>
      {partner.users.map((user) => <div className="pt-login" key={user.user_id}>
        <span className="fb-customer-avatar"><UserRound size={14} /></span>
        <span><strong>{user.full_name || user.email}</strong><small>{user.email}</small></span>
        <button className="icon-button" aria-label={`Slet login ${user.email}`} onClick={() => {
          if (window.confirm(`Slet login for ${user.email}? Personen kan ikke længere logge ind på partnerportalen.`)) void onDeleteLogin(user.user_id).catch(() => undefined);
        }}><Trash2 size={14} /></button>
      </div>)}
      {!partner.users.length && <p className="fb-muted">Intet login endnu. Opret et login, så partneren kan se møder og give status.</p>}
    </section>

    {editingDetails && <PartnerDialog partner={partner} onClose={() => setEditingDetails(false)}
      onSave={(input) => onUpdatePartner({ id: partner.id, ...input })} />}
    {addingLogin && <LoginDialog partner={partner} onClose={() => setAddingLogin(false)} onSave={onCreateLogin} />}
  </article>;
}

function DialogShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>
      {children}
    </section>
  </div>;
}

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Noget gik galt. Prøv igen.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function PartnerDialog({ partner, onClose, onSave }: {
  partner?: Partner; onClose: () => void;
  onSave: (input: { name: string; contact_name: string; contact_email: string; contact_phone: string; campaign_name?: string }) => Promise<void>;
}) {
  const { busy, error, run } = useSubmit(onClose);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => onSave({
      name: String(form.get("name") ?? ""), contact_name: String(form.get("contact_name") ?? ""),
      contact_email: String(form.get("contact_email") ?? ""), contact_phone: String(form.get("contact_phone") ?? ""),
      ...(partner ? {} : { campaign_name: String(form.get("campaign_name") ?? "") }),
    }));
  }
  return <DialogShell eyebrow="SAMARBEJDSPARTNER" title={partner ? `Rediger ${partner.name}` : "Opret samarbejdspartner"} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>Firmanavn<input name="name" required minLength={2} maxLength={160} defaultValue={partner?.name} placeholder="F.eks. Aibooking ApS" /></label>
      <label>Kontaktperson<input name="contact_name" maxLength={120} defaultValue={partner?.contact_name} /></label>
      <label>Kontakt-e-mail<input name="contact_email" type="email" maxLength={200} defaultValue={partner?.contact_email} /></label>
      <label>Telefon<input name="contact_phone" maxLength={40} defaultValue={partner?.contact_phone} /></label>
      {!partner && <label>Første kampagne (valgfri)<input name="campaign_name" maxLength={120} placeholder="F.eks. Aibooking – efterår" />
        <small className="fb-muted">Efter oprettelsen kommer du direkte videre til at uploade leads til kampagnen.</small></label>}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Annuller</button>
        <button className="button button-primary" disabled={busy}>{busy ? "Gemmer …" : partner ? "Gem" : "Opret partner"} <ArrowRight size={15} /></button></div>
    </form>
  </DialogShell>;
}

function LoginDialog({ partner, onClose, onSave }: {
  partner: Partner; onClose: () => void;
  onSave: (input: { partner_id: string; full_name: string; email: string; password: string }) => Promise<void>;
}) {
  const { busy, error, run } = useSubmit(onClose);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => onSave({
      partner_id: partner.id, full_name: String(form.get("full_name") ?? ""),
      email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""),
    }));
  }
  return <DialogShell eyebrow={partner.name.toUpperCase()} title="Opret login til partnerportalen" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>Navn<input name="full_name" maxLength={120} placeholder="Valgfrit" /></label>
      <label>E-mail<input name="email" type="email" required autoComplete="off" /></label>
      <label>Adgangskode<input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="Mindst 8 tegn" /></label>
      <p className="fb-muted">Personen logger ind på <strong>/kunde</strong> og ser kun møder fra {partner.name}s kampagner. Login giver ingen adgang til sælgernes arbejdsplads.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Annuller</button>
        <button className="button button-primary" disabled={busy}>{busy ? "Opretter …" : "Opret login"} <ArrowRight size={15} /></button></div>
    </form>
  </DialogShell>;
}
