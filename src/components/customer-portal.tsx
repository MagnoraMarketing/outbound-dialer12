"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  AlertTriangle, ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink,
  List, LogOut, Mail, Phone, UserRound, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  copenhagenDayKey, feedbackLabels, meetingState, meetingStateLabels, meetingTypeLabel, type FeedbackStatus,
} from "@/lib/feedback-labels";

type CustomerMeeting = {
  id: string; meeting_at: string; meeting_type: string; notes: string; calendar_url: string | null;
  seller_name: string; campaign_name: string; company_name: string; contact_person: string | null;
  phone: string | null; email: string | null;
  feedback: { status: FeedbackStatus; note: string; updated_at: string } | null;
  overdue: boolean;
};
type CustomerInfo = { full_name: string; company_name: string; email: string };
type AuthMode = "login" | "forgot" | "recovery";
type Filter = "all" | "overdue" | "awaiting" | "upcoming" | "rated";

const weekdays = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key) : null;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
  }).format(new Date(value));
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">nordcall<span>.</span></span></div>;
}

export function CustomerPortal() {
  const [supabase] = useState<SupabaseClient | null>(() => browserSupabase());
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [meetings, setMeetings] = useState<CustomerMeeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [noAccess, setNoAccess] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [filter, setFilter] = useState<Filter>("all");
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(() => copenhagenDayKey(new Date()));
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    const params = new URLSearchParams(window.location.search);
    if (params.get("recovery") === "1") setAuthMode("recovery");
    if (params.get("authError")) setAuthError("Linket er udløbet eller ugyldigt. Bed om et nyt.");
    void supabase.auth.getUser().then(({ data }) => { setUser(data.user); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setAuthMode("recovery");
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/customer/meetings");
      const body = await response.json().catch(() => null);
      if (response.status === 403) { setNoAccess(body?.error ?? "Din bruger har ikke adgang til kundeportalen."); return; }
      if (!response.ok) throw new Error(body?.error ?? "Møderne kunne ikke hentes.");
      setNoAccess("");
      setCustomer(body.customer);
      setMeetings(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Møderne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || authMode === "recovery") return;
    void loadMeetings();
    // Refresh so reminders appear without reloading the page.
    const timer = window.setInterval(() => void loadMeetings(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [user, authMode, loadMeetings]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (authMode === "forgot") {
        const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
        const appUrl = configuredAppUrl?.startsWith("https://") ? configuredAppUrl : window.location.origin;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent("/kunde")}&recovery=1`,
        });
        if (resetError) throw resetError;
        setAuthMessage("Hvis adressen findes, har vi sendt et link til nulstilling. Tjek også spam-mappen.");
      } else if (authMode === "recovery") {
        if (password.length < 8) throw new Error("Adgangskoden skal være mindst 8 tegn.");
        if (password !== String(form.get("password_confirmation") ?? "")) throw new Error("Adgangskoderne er ikke ens.");
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        window.history.replaceState(null, "", "/kunde");
        setAuthMode("login");
        setAuthMessage("Adgangskoden er ændret.");
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw new Error("Forkert e-mail eller adgangskode.");
      }
    } catch (submitError) {
      setAuthError(submitError instanceof Error ? submitError.message : "Noget gik galt. Prøv igen.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await supabase?.auth.signOut();
    setUser(null);
    setMeetings([]);
    setCustomer(null);
    setNoAccess("");
  }

  async function saveFeedback(meetingId: string, status: FeedbackStatus, note: string) {
    const response = await fetch(`/api/customer/meetings/${meetingId}/feedback`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Status kunne ikke gemmes.");
    setMeetings((current) => current.map((meeting) => meeting.id === meetingId
      ? { ...meeting, feedback: body.data, overdue: false } : meeting));
  }

  const now = Date.now();
  const overdue = meetings.filter((meeting) => meeting.overdue);
  const counts = useMemo(() => ({
    overdue: meetings.filter((meeting) => meetingState(meeting) === "overdue").length,
    awaiting: meetings.filter((meeting) => meetingState(meeting) === "awaiting").length,
    upcoming: meetings.filter((meeting) => meetingState(meeting) === "upcoming").length,
    rated: meetings.filter((meeting) => meeting.feedback).length,
  }), [meetings]);
  const meetingsByDay = useMemo(() => {
    const byDay = new Map<string, CustomerMeeting[]>();
    for (const meeting of meetings) {
      const key = copenhagenDayKey(meeting.meeting_at);
      byDay.set(key, [...(byDay.get(key) ?? []), meeting]);
    }
    return byDay;
  }, [meetings]);
  const listMeetings = meetings
    .filter((meeting) => filter === "all"
      || (filter === "rated" ? Boolean(meeting.feedback) : meetingState(meeting, now) === filter))
    .sort((a, b) => filter === "upcoming" ? a.meeting_at.localeCompare(b.meeting_at) : b.meeting_at.localeCompare(a.meeting_at));
  const openMeeting = meetings.find((meeting) => meeting.id === openMeetingId) ?? null;

  if (authLoading) return <div className="auth-screen"><div className="loading-orbit" /><p>Henter kundeportalen …</p></div>;

  if (!supabase || !user || authMode === "recovery") {
    return <div className="auth-screen"><div className="auth-glow" /><div className="auth-card">
      <Brand />
      <div className="auth-heading">
        <span className="eyebrow">{authMode === "recovery" ? "NY ADGANGSKODE" : authMode === "forgot" ? "KONTOGENDANNELSE" : "KUNDEPORTAL"}</span>
        <h1>{authMode === "recovery" ? "Vælg ny adgangskode" : authMode === "forgot" ? "Nulstil adgangskode" : "Dine møder samlet ét sted"}</h1>
        <p>{authMode === "recovery" ? "Vælg en adgangskode på mindst 8 tegn." : authMode === "forgot" ? "Vi sender et sikkert link til din e-mail." : "Se de møder, vi har booket for dig, og giv status efter hvert møde."}</p>
      </div>
      {!supabase ? <p className="form-error">Kundeportalen er ikke konfigureret endnu.</p> : <form className="auth-form" onSubmit={submitAuth}>
        {authMode !== "recovery" && <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="dig@virksomhed.dk" /></label>}
        {authMode !== "forgot" && <label>{authMode === "recovery" ? "Ny adgangskode" : "Adgangskode"}<input name="password" type="password" autoComplete={authMode === "recovery" ? "new-password" : "current-password"} required minLength={8} placeholder="Mindst 8 tegn" /></label>}
        {authMode === "recovery" && <label>Gentag adgangskode<input name="password_confirmation" type="password" autoComplete="new-password" required minLength={8} /></label>}
        {authError && <p className="form-error">{authError}</p>}
        {authMessage && <p className="form-success">{authMessage}</p>}
        {authMode === "login" && <button type="button" className="text-button auth-resend" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthMessage(""); }}>Glemt adgangskode?</button>}
        <button className="button button-primary button-wide" disabled={authBusy}>{authBusy ? "Et øjeblik …" : authMode === "forgot" ? "Send nulstillingslink" : authMode === "recovery" ? "Gem adgangskode" : "Log ind"} <ArrowRight size={16} /></button>
        {authMode === "forgot" && <button type="button" className="text-button auth-resend" onClick={() => setAuthMode("login")}>Tilbage til login</button>}
      </form>}
      <div className="auth-privacy"><CheckCircle2 size={15} /> Du ser kun møder fra dine egne kampagner</div>
    </div><div className="auth-caption">Kundeportal for Nordcall.</div></div>;
  }

  if (noAccess) {
    return <div className="auth-screen"><div className="auth-glow" /><div className="auth-card">
      <Brand /><div className="auth-heading"><span className="eyebrow">KUNDEPORTAL</span><h1>Ingen kundeadgang</h1><p>{noAccess}</p></div>
      <button className="button button-secondary button-wide" onClick={() => void logout()}>Log ud</button>
    </div></div>;
  }

  return <div className="cp-shell">
    <header className="cp-header">
      <Brand />
      <div className="cp-header-actions">
        <span className="cp-bell" aria-label={overdue.length ? `${overdue.length} møder mangler status` : "Ingen påmindelser"}>
          <Bell size={17} />{overdue.length > 0 && <i>{overdue.length}</i>}
        </span>
        <span className="cp-customer"><strong>{customer?.company_name || "Kunde"}</strong><small>{customer?.email}</small></span>
        <button className="icon-button" onClick={() => void logout()} aria-label="Log ud"><LogOut size={16} /></button>
      </div>
    </header>
    <main className="cp-main">
      <div className="page-heading"><div><span className="eyebrow">KUNDEPORTAL</span><h1>Dine møder</h1><p>Se de bookede møder og fortæl os, hvordan hvert møde gik.</p></div>
        <div className="cp-toggle" role="tablist">
          <button role="tab" aria-selected={view === "calendar"} className={view === "calendar" ? "cp-toggle-active" : ""} onClick={() => setView("calendar")}><CalendarDays size={15} /> Kalender</button>
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "cp-toggle-active" : ""} onClick={() => setView("list")}><List size={15} /> Liste</button>
        </div>
      </div>
      {error && <div className="toast toast-error" role="status"><span>{error}</span><button aria-label="Luk besked" onClick={() => setError("")}><X size={16} /></button></div>}

      {overdue.length > 0 && <section className="cp-reminder" role="alert">
        <span className="cp-reminder-icon"><AlertTriangle size={18} /></span>
        <div><strong>{overdue.length === 1 ? "1 møde mangler din status" : `${overdue.length} møder mangler din status`}</strong>
          <p>Det er mere end 12 timer siden mødet. Giv en kort status, så sælgeren ved, hvordan det gik.</p></div>
        <button className="button button-primary" onClick={() => setOpenMeetingId(overdue[0].id)}>Giv status nu <ArrowRight size={15} /></button>
      </section>}

      <section className="cp-stats">
        {([["overdue", "Mangler status", counts.overdue], ["awaiting", "Afventer status", counts.awaiting], ["upcoming", "Kommende", counts.upcoming], ["rated", "Med status", counts.rated]] as const).map(([key, label, value]) =>
          <button key={key} className={`cp-stat cp-stat-${key} ${view === "list" && filter === key ? "cp-stat-active" : ""}`} onClick={() => { setView("list"); setFilter(filter === key ? "all" : key); }}>
            <span>{label}</span><strong>{value}</strong>
          </button>)}
      </section>

      {view === "calendar" ? <section className="cp-calendar-layout">
        <div className="panel cp-calendar">
          <div className="cp-calendar-head">
            <button className="icon-button" aria-label="Forrige måned" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
            <h2>{new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric" }).format(month)}</h2>
            <button className="icon-button" aria-label="Næste måned" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
          </div>
          <div className="cp-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="cp-days">{calendarDays(month).map(({ key, day, inMonth }) => {
            const dayMeetings = meetingsByDay.get(key) ?? [];
            return <button key={key} className={`cp-day ${inMonth ? "" : "cp-day-outside"} ${key === selectedDay ? "cp-day-selected" : ""} ${key === copenhagenDayKey(new Date()) ? "cp-day-today" : ""}`}
              onClick={() => setSelectedDay(key)} aria-label={`${day}. ${dayMeetings.length} møder`}>
              <span>{day}</span>
              {dayMeetings.length > 0 && <span className="cp-dots">{dayMeetings.slice(0, 4).map((meeting) => <i key={meeting.id} className={`fb-dot fb-${meetingState(meeting, now)}`} />)}</span>}
            </button>;
          })}</div>
        </div>
        <div className="panel cp-day-panel">
          <span className="panel-eyebrow">{new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${selectedDay}T12:00:00`)).toUpperCase()}</span>
          <h2>{(meetingsByDay.get(selectedDay) ?? []).length ? "Møder denne dag" : "Ingen møder denne dag"}</h2>
          <div className="cp-meeting-list">{(meetingsByDay.get(selectedDay) ?? []).map((meeting) =>
            <MeetingRow key={meeting.id} meeting={meeting} now={now} onOpen={() => setOpenMeetingId(meeting.id)} />)}</div>
        </div>
      </section> : <section className="panel cp-list">
        <div className="cp-filters">{(["all", "overdue", "awaiting", "upcoming", "rated"] as const).map((key) =>
          <button key={key} className={filter === key ? "cp-filter-active" : ""} onClick={() => setFilter(key)}>
            {key === "all" ? "Alle" : key === "overdue" ? "Mangler status" : key === "awaiting" ? "Afventer status" : key === "upcoming" ? "Kommende" : "Med status"}
          </button>)}</div>
        <div className="cp-meeting-list">{listMeetings.map((meeting) =>
          <MeetingRow key={meeting.id} meeting={meeting} now={now} showDate onOpen={() => setOpenMeetingId(meeting.id)} />)}
          {!listMeetings.length && <p className="cp-empty">{loading ? "Henter møder …" : "Ingen møder her endnu."}</p>}
        </div>
      </section>}
    </main>
    {openMeeting && <MeetingDialog meeting={openMeeting} now={now} onClose={() => setOpenMeetingId(null)} onSave={saveFeedback} />}
  </div>;
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, day: date.getDate(), inMonth: date.getMonth() === month.getMonth() };
  });
}

function MeetingRow({ meeting, now, showDate = false, onOpen }: { meeting: CustomerMeeting; now: number; showDate?: boolean; onOpen: () => void }) {
  const state = meetingState(meeting, now);
  return <button className={`cp-meeting ${state === "overdue" ? "cp-meeting-overdue" : ""}`} onClick={onOpen}>
    <span className="cp-meeting-time"><Clock3 size={14} /> {showDate ? formatDateTime(meeting.meeting_at) : formatTime(meeting.meeting_at)}</span>
    <span className="cp-meeting-body"><strong>{meeting.company_name}</strong><small>{meeting.contact_person || "Kontaktperson ikke angivet"} · {meetingTypeLabel(meeting.meeting_type)}</small></span>
    <span className={`fb-badge fb-${state}`}>{meetingStateLabels[state]}</span>
  </button>;
}

function MeetingDialog({ meeting, now, onClose, onSave }: {
  meeting: CustomerMeeting; now: number; onClose: () => void; onSave: (id: string, status: FeedbackStatus, note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<FeedbackStatus | null>(meeting.feedback?.status ?? null);
  const [note, setNote] = useState(meeting.feedback?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const state = meetingState(meeting, now);
  const held = Date.parse(meeting.meeting_at) <= now;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status) { setError("Vælg en status for mødet."); return; }
    setBusy(true);
    setError("");
    try {
      await onSave(meeting.id, status, note);
      setMessage("Tak! Sælgeren kan nu se din status og note.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Status kunne ikke gemmes.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card cp-dialog" role="dialog" aria-modal="true" aria-label={meeting.company_name}>
      <div className="modal-header"><div><span className="eyebrow">{formatDateTime(meeting.meeting_at).toUpperCase()}</span><h2>{meeting.company_name}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Luk"><X size={17} /></button></div>
      <span className={`fb-badge fb-${state}`}>{meetingStateLabels[state]}</span>
      <dl className="cp-details">
        <div><dt><UserRound size={14} /> Kontaktperson</dt><dd>{meeting.contact_person || "—"}</dd></div>
        <div><dt><Phone size={14} /> Telefon</dt><dd>{meeting.phone ? <a href={`tel:${meeting.phone}`}>{meeting.phone}</a> : "—"}</dd></div>
        <div><dt><Mail size={14} /> E-mail</dt><dd>{meeting.email ? <a href={`mailto:${meeting.email}`}>{meeting.email}</a> : "—"}</dd></div>
        <div><dt><CalendarDays size={14} /> Mødetype</dt><dd>{meetingTypeLabel(meeting.meeting_type)}</dd></div>
        <div><dt>Booket af</dt><dd>{meeting.seller_name}</dd></div>
        <div><dt>Kampagne</dt><dd>{meeting.campaign_name || "—"}</dd></div>
      </dl>
      {meeting.calendar_url && <a className="text-button cp-link" href={meeting.calendar_url} target="_blank" rel="noreferrer">Åbn mødelink <ExternalLink size={13} /></a>}
      {meeting.notes && <div className="cp-notes"><strong>Noter fra sælgeren</strong><p>{meeting.notes}</p></div>}
      {held ? <form className="cp-feedback-form" onSubmit={submit}>
        <strong>Hvordan gik mødet?</strong>
        <div className="cp-status-choices">{(Object.keys(feedbackLabels) as FeedbackStatus[]).map((key) =>
          <button type="button" key={key} className={`cp-status-choice fb-choice-${key} ${status === key ? "cp-status-selected" : ""}`} onClick={() => setStatus(key)} aria-pressed={status === key}>
            {feedbackLabels[key]}
          </button>)}</div>
        <label>Note til sælgeren<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} placeholder="F.eks. hvad der gik godt, eller hvorfor mødet ikke var relevant." /></label>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? "Gemmer …" : meeting.feedback ? "Opdater status" : "Gem status"}</button>
      </form> : <p className="cp-future-note">Du kan give status, når mødet er afholdt.</p>}
    </section>
  </div>;
}
