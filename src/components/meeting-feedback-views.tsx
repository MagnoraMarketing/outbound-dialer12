"use client";

import { AlertTriangle, ArrowRight, MessageSquareText, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { feedbackLabels, meetingState, meetingStateLabels, meetingTypeLabel, type FeedbackStatus, type MeetingState } from "@/lib/feedback-labels";

export type MeetingFeedbackInfo = { status: FeedbackStatus; note: string; updated_at: string; unseen?: boolean };
export type FeedbackMeeting = {
  id: string; meeting_at: string; meeting_type: string; overdue: boolean; has_customer: boolean;
  feedback: MeetingFeedbackInfo | null;
};
export type AdminFeedbackMeeting = FeedbackMeeting & {
  seller_id: string; seller_name: string; campaign_id: string | null; campaign_name: string; company_name: string; contact_person: string | null;
};
export type CampaignOption = { id: string; name: string };

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}

export function FeedbackBadge({ meeting }: { meeting: FeedbackMeeting }) {
  if (!meeting.has_customer && !meeting.feedback) return null;
  const state = meetingState(meeting);
  return <span className={`fb-badge fb-${state}`}>{meetingStateLabels[state]}</span>;
}

// Seller dashboard: partner feedback on the seller's own meetings, newest first.
export function SellerFeedbackPanel({ meetings, onOpenMeetings }: {
  meetings: (FeedbackMeeting & { leads?: { company_name?: string | null } | null })[]; onOpenMeetings: () => void;
}) {
  const relevant = meetings.filter((meeting) => meeting.has_customer || meeting.feedback);
  if (!relevant.length) return null;
  const unseen = relevant.filter((meeting) => meeting.feedback?.unseen).length;
  const counts = (["good", "less_good", "not_qualified", "overdue", "awaiting"] as MeetingState[])
    .map((state) => [state, relevant.filter((meeting) => meetingState(meeting) === state).length] as const);
  const recent = [...relevant]
    .filter((meeting) => meeting.feedback || meeting.overdue)
    .sort((a, b) => Number(Boolean(b.feedback?.unseen)) - Number(Boolean(a.feedback?.unseen))
      || (b.feedback?.updated_at ?? b.meeting_at).localeCompare(a.feedback?.updated_at ?? a.meeting_at))
    .slice(0, 5);
  return <section className="panel fb-panel">
    <div className="panel-heading"><div><span className="panel-eyebrow">PARTNERNES STATUS</span><h2>Feedback på dine møder {unseen > 0 && <span className="fb-new-count">{unseen} ny{unseen === 1 ? "" : "e"}</span>}</h2></div>
      <button className="text-button" onClick={onOpenMeetings}>Se alle møder <ArrowRight size={14} /></button></div>
    <div className="fb-counts">{counts.map(([state, value]) => <span key={state} className={`fb-badge fb-${state}`}>{meetingStateLabels[state]} · {value}</span>)}</div>
    <div className="fb-recent">{recent.map((meeting) => <div key={meeting.id} className={`fb-recent-row ${meeting.feedback?.unseen ? "fb-recent-unseen" : ""}`}>
      {meeting.feedback?.unseen && <i className="fb-unseen-dot" aria-label="Ny feedback" />}
      <span><strong>{meeting.leads?.company_name || "Virksomhed"}</strong><small>{formatDateTime(meeting.meeting_at)}</small></span>
      <FeedbackBadge meeting={meeting} />
      {meeting.feedback?.note && <p>“{meeting.feedback.note}”</p>}
    </div>)}
      {!recent.length && <p className="fb-empty">Når samarbejdspartnerne giver status på dine møder, vises det her.</p>}</div>
  </section>;
}

export function AdminFeedbackView({ meetings, campaigns, loading, onOpenPartners }: {
  meetings: AdminFeedbackMeeting[]; campaigns: CampaignOption[]; loading: boolean; onOpenPartners: () => void;
}) {
  const [stateFilter, setStateFilter] = useState<MeetingState | "all">("all");
  const [sellerFilter, setSellerFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const relevant = useMemo(() => meetings.filter((meeting) => meeting.has_customer || meeting.feedback), [meetings]);
  const overdue = relevant.filter((meeting) => meeting.overdue).sort((a, b) => a.meeting_at.localeCompare(b.meeting_at));
  const sellers = [...new Map(relevant.map((meeting) => [meeting.seller_id, meeting.seller_name])).entries()];
  const filtered = relevant.filter((meeting) => (stateFilter === "all" || meetingState(meeting) === stateFilter)
    && (!sellerFilter || meeting.seller_id === sellerFilter) && (!campaignFilter || meeting.campaign_id === campaignFilter));
  const states: MeetingState[] = ["overdue", "good", "less_good", "not_qualified", "awaiting", "upcoming"];

  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION · SENESTE 90 DAGE</span><h1>Mødefeedback</h1><p>Samarbejdspartnernes status på bookede møder, og hvilke møder der mangler status.</p></div>
      <button className="button button-secondary" onClick={onOpenPartners}><Users size={16} /> Samarbejdspartnere</button></div>

    <section className="fb-summary">{states.map((state) => {
      const count = relevant.filter((meeting) => meetingState(meeting) === state).length;
      return <button key={state} className={`fb-summary-card fb-summary-${state} ${stateFilter === state ? "fb-summary-active" : ""}`} onClick={() => setStateFilter(stateFilter === state ? "all" : state)}>
        <span>{meetingStateLabels[state]}</span><strong>{count}</strong>
      </button>;
    })}</section>

    {overdue.length > 0 && <section className="panel fb-overdue-panel">
      <div className="panel-heading"><div><span className="panel-eyebrow">OVERSKREDET · MERE END 12 TIMER UDEN STATUS</span><h2><AlertTriangle size={16} /> {overdue.length} møder mangler partnerens status</h2></div></div>
      <div className="table-scroll"><table><thead><tr><th>Møde</th><th>Virksomhed</th><th>Kampagne</th><th>Sælger</th><th>Overskredet</th></tr></thead><tbody>
        {overdue.map((meeting) => <tr key={meeting.id}><td>{formatDateTime(meeting.meeting_at)}</td><td><strong>{meeting.company_name}</strong></td>
          <td>{meeting.campaign_name || "—"}</td><td>{meeting.seller_name}</td><td className="fb-overdue-time">{overdueFor(meeting.meeting_at)}</td></tr>)}
      </tbody></table></div>
    </section>}

    <section className="panel fb-table">
      <div className="panel-heading fb-table-heading"><div><span className="panel-eyebrow">MØDER PÅ PARTNERNES KAMPAGNER</span><h2>Status og feedback</h2></div>
        <div className="fb-table-filters">
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as MeetingState | "all")}><option value="all">Alle statusser</option>{states.map((state) => <option key={state} value={state}>{meetingStateLabels[state]}</option>)}</select>
          <select value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}><option value="">Alle sælgere</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}><option value="">Alle kampagner</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
        </div></div>
      <div className="table-scroll"><table><thead><tr><th>Møde</th><th>Virksomhed</th><th>Kampagne</th><th>Sælger</th><th>Status</th><th>Partnerens note</th></tr></thead><tbody>
        {filtered.map((meeting) => <tr key={meeting.id}><td>{formatDateTime(meeting.meeting_at)}<small className="table-sub">{meetingTypeLabel(meeting.meeting_type)}</small></td>
          <td><strong>{meeting.company_name}</strong><small className="table-sub">{meeting.contact_person || ""}</small></td>
          <td>{meeting.campaign_name || "—"}</td><td>{meeting.seller_name}</td><td><FeedbackBadge meeting={meeting} /></td>
          <td className="fb-note-cell">{meeting.feedback?.note || <span className="fb-muted">—</span>}</td></tr>)}
        {!filtered.length && <tr><td colSpan={6} className="fb-empty">{loading ? "Henter møder …" : "Ingen møder matcher filtrene. Møder vises her, når kampagnen tilhører en samarbejdspartner med login."}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function overdueFor(meetingAt: string) {
  const hours = Math.floor((Date.now() - Date.parse(meetingAt)) / 3_600_000) - 12;
  return hours < 24 ? `${Math.max(1, hours)} t over fristen` : `${Math.floor(hours / 24)} d over fristen`;
}

export function MeetingFeedbackNote({ feedback }: { feedback: MeetingFeedbackInfo | null }) {
  if (!feedback) return null;
  return <div className={`fb-meeting-note ${feedback.unseen ? "fb-meeting-note-unseen" : ""}`}>
    <span><MessageSquareText size={13} /> Partnerens status · {feedbackLabels[feedback.status]}{feedback.unseen && <i className="fb-new-tag">Ny</i>}</span>
    {feedback.note && <p>{feedback.note}</p>}
  </div>;
}

