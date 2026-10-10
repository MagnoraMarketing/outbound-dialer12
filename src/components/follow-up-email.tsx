"use client";

import { Mail, Send, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

type Draft = { to: string; subject: string; body: string; reply_to: string; can_send: boolean };

// Review and send the campaign's follow-up e-mail to a lead after the call.
export function FollowUpEmailDialog({ leadId, companyName, onClose, onSent }: {
  leadId: string; companyName: string; onClose: () => void; onSent: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/leads/${leadId}/email`).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!alive) return;
      if (!response.ok) setError(body?.error ?? "E-mailen kunne ikke hentes.");
      else setDraft(body.data);
    }).catch(() => { if (alive) setError("E-mailen kunne ikke hentes."); });
    return () => { alive = false; };
  }, [leadId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.can_send) {
      // No mail provider on the server: hand the e-mail to the seller's own mail program.
      const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
      if (draft.reply_to) params.set("cc", draft.reply_to);
      window.location.href = `mailto:${encodeURIComponent(draft.to)}?${params.toString().replace(/\+/g, "%20")}`;
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/leads/${leadId}/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: draft.to, subject: draft.subject, body: draft.body }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "E-mailen kunne ikke sendes.");
      onSent(`E-mailen er sendt til ${draft.to}.`);
      onClose();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "E-mailen kunne ikke sendes.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-label="Send e-mail">
      <div className="modal-header"><div><span className="eyebrow">E-MAIL EFTER SAMTALE</span><h2>{companyName}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Luk"><X size={17} /></button></div>
      {!draft && !error && <p className="fb-muted">Henter kampagnens e-mail …</p>}
      {error && !draft && <p className="form-error">{error}</p>}
      {draft && <form className="modal-form" onSubmit={submit}>
        <label>Til<input type="email" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} placeholder="kontakt@virksomhed.dk" /></label>
        <label>Emne<input required maxLength={200} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
        <label>Tekst<textarea required rows={9} maxLength={10000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        {!draft.can_send && <p className="fb-muted">Mailen åbnes i dit eget mailprogram, så du kan sende den derfra.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Annuller</button>
          <button className="button button-primary" disabled={busy}>{draft.can_send ? <Send size={15} /> : <Mail size={15} />} {busy ? "Sender …" : draft.can_send ? "Send e-mail" : "Åbn i mailprogram"}</button>
        </div>
      </form>}
    </section>
  </div>;
}
