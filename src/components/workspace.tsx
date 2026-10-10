"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import Papa from "papaparse";
import {
  Activity, ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, Bell, Building2,
  CalendarClock, CalendarDays, Check, CheckCircle2, ChevronDown, ClipboardCheck, Gamepad2, PhoneForwarded, Handshake, BadgeCheck, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, FileSpreadsheet, Filter, Headphones, LayoutDashboard, LogOut, Menu,
  MessageSquareText, MoreHorizontal, Phone, PhoneCall, Plus, Search, Settings2, SlidersHorizontal, Sparkles,
  Target, Timer, Trash2, Users, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminFeedbackView, FeedbackBadge, MeetingFeedbackNote, SellerFeedbackPanel,
  type AdminFeedbackMeeting, type MeetingFeedbackInfo,
} from "@/components/meeting-feedback-views";
import { PartnersView, type PartnerData } from "@/components/partners-view";
import { MagnoraEmpire } from "@/components/game/magnora-empire";
import { EarningsApprovals } from "@/components/earnings-approvals";
import { PhoneNumbersView } from "@/components/phone-numbers-view";
import { meetingState, meetingStateLabels, type MeetingState } from "@/lib/feedback-labels";

type AccessMode = "all" | "assigned";
type Profile = { id: string; team_id: string | null; full_name: string; role: "admin" | "manager" | "salesperson"; recordings_enabled: boolean; call_recording_enabled: boolean; access_mode?: AccessMode; can_dial_manual?: boolean };
type Lead = {
  id: string; company_name: string; cvr: string | null; contact_person: string | null; phone: string;
  email?: string | null; website?: string | null; address?: string | null; city: string | null;
  industry?: string | null; employee_count?: number | null; notes: string; status: string;
  assigned_user_id: string | null; next_follow_up_at: string | null; created_at: string;
};
type DashboardData = {
  calls: number; connected: number; conversations: number; meetings: number; conversion_rate: number;
  talk_time: number; leads_remaining: number; callbacks: number;
  performance: { user_id: string; name: string; calls: number; meetings: number; talk_time: number }[];
  activity: { key: string; label: string; calls: number; connected: number }[];
};
type BudgetEntry = {
  id: string; user_id: string; user_name: string; role: Profile["role"]; campaign_id: string | null;
  campaign_name: string | null; weekly_target: number; monthly_target: number;
  activity_mode: "meeting" | "sale" | "both";
  commission_per_meeting: number; commission_per_sale: number;
  weekly_meeting_target: number; weekly_sale_target: number;
  weekly_meetings: number; monthly_meetings: number; weekly_sales: number; monthly_sales: number;
  monthly_commission: number; expected_monthly_commission: number; updated_at: string;
};
type BudgetActivity = { id: string; user_id: string; campaign_id: string; event_type: "meeting" | "sale"; created_at: string };
type CampaignBudgetSettings = {
  activity_mode: "meeting" | "sale" | "both";
  commission_per_meeting: number;
  commission_per_sale: number;
  weekly_meeting_target: number;
  weekly_sale_target: number;
};
type BudgetReport = {
  data: BudgetEntry[];
  members: { id: string; full_name: string; role: Profile["role"] }[];
  campaigns: { id: string; name: string }[];
  activities: BudgetActivity[];
  system_fee?: { fee_dkk: number; users: Record<string, { gross: number; covered: number; own: number }> };
};
type TeamMessage = {
  id: string; broadcast_id: string; recipient_user_id: string; sent_by: string;
  campaign_id: string | null; lead_list_id: string | null;
  title: string; body: string; created_at: string; read_at: string | null; recipient_count?: number;
};
type Call = { id: string; lead_id: string | null; phone: string; caller_number?: string | null; started_at: string; duration_seconds: number; status: string; outcome: string | null; notes: string; recording_url?: string | null; leads?: { company_name: string; contact_person: string | null } | null };
type TelnyxClient = InstanceType<typeof import("@telnyx/webrtc").TelnyxRTC>;
type TelnyxCall = import("@telnyx/webrtc").Call;
type LeadHistoryEntry = {
  id: string; kind: "call" | "note" | "meeting"; user_id: string | null; created_at: string; title: string;
  body: string | null; duration_seconds: number | null; recording_url: string | null;
};
type Callback = { id: string; lead_id: string; callback_at: string; notes: string; leads?: Pick<Lead, "company_name" | "contact_person" | "phone"> };
type Meeting = {
  id: string; user_id: string; meeting_at: string; meeting_type: string; notes: string; calendar_url: string | null;
  leads?: Pick<Lead, "company_name" | "contact_person" | "phone"> | null;
  has_customer: boolean; overdue: boolean; feedback: MeetingFeedbackInfo | null;
};
type TeamMember = {
  id: string; full_name: string; role: Profile["role"]; created_at: string; recordings_enabled: boolean; call_recording_enabled: boolean;
  access_mode: AccessMode; can_dial_manual: boolean;
  campaign_ids?: string[]; lead_list_ids?: string[];
};
type LeadFilters = { city: string; industry: string; employees_min: string; employees_max: string; assigned_user_id: string; last_contacted_after: string; callback_after: string };
type Campaign = { id: string; name: string; created_at: string };
type LeadList = { id: string; campaign_id: string; name: string; created_at: string };
type TeamAdminData = { data: TeamMember[]; campaigns: Campaign[]; lead_lists: LeadList[] };
type ManagedRole = "admin" | "user";
type AdminOverview = {
  period_start: string;
  totals: { calls: number; connected: number; meetings: number; talk_time: number; users: number };
  campaigns: { id: string; name: string; calls: number; connected: number; meetings: number; talk_time: number }[];
};
type Page = "dashboard" | "budget" | "leads" | "dialer" | "dialpad" | "callbacks" | "meetings" | "history" | "import" | "team" | "partners" | "feedback" | "earnings" | "numbers" | "game" | "messages" | "settings";
type CsvField = "company_name" | "cvr" | "contact_person" | "phone" | "email" | "website" | "address" | "city" | "industry" | "employee_count" | "notes";
type CsvRow = Record<string, string>;

const statuses: Record<string, string> = {
  new: "Ny", to_call: "Skal ringes", called: "Ringet", no_answer: "Intet svar", callback: "Ring tilbage",
  interested: "Interesseret", meeting_booked: "Møde booket", not_interested: "Ikke interesseret",
  wrong_number: "Forkert nummer", do_not_call: "Ring ikke", converted: "Konverteret",
};
const statusChoices = ["new", "to_call", "called", "no_answer", "callback", "interested", "meeting_booked", "not_interested", "wrong_number", "do_not_call", "converted"];
const navGroups: { label: string; items: { id: Page; title: string; icon: typeof LayoutDashboard }[] }[] = [
  { label: "ARBEJDSPLADS", items: [
    { id: "dashboard", title: "Overblik", icon: LayoutDashboard },
    { id: "budget", title: "Budget", icon: Target },
    { id: "leads", title: "Virksomheder", icon: Building2 },
    { id: "dialer", title: "Opkald", icon: PhoneCall },
    { id: "dialpad", title: "Dialpad", icon: Phone },
    { id: "callbacks", title: "Callbacks", icon: CalendarClock },
    { id: "meetings", title: "Møder", icon: CalendarDays },
  ] },
  { label: "DATA", items: [
    { id: "history", title: "Opkaldshistorik", icon: Activity },
    { id: "import", title: "Importer leads", icon: FileSpreadsheet },
  ] },
  { label: "SAMARBEJDE", items: [
    { id: "messages", title: "Beskeder", icon: MessageSquareText },
  ] },
  { label: "ADMINISTRATION", items: [
    { id: "team", title: "Team", icon: Users },
    { id: "partners", title: "Samarbejdspartnere", icon: Handshake },
    { id: "feedback", title: "Mødefeedback", icon: ClipboardCheck },
    { id: "earnings", title: "Godkend indtjening", icon: BadgeCheck },
    { id: "numbers", title: "Telefonnumre", icon: PhoneForwarded },
    { id: "settings", title: "Indstillinger", icon: Settings2 },
  ] },
  { label: "MAGNORA EMPIRE", items: [
    { id: "game", title: "Spil", icon: Gamepad2 },
  ] },
];
const csvFields: { key: CsvField; label: string }[] = [
  { key: "company_name", label: "Virksomhed" }, { key: "cvr", label: "CVR" },
  { key: "contact_person", label: "Kontaktperson" }, { key: "phone", label: "Telefon" },
  { key: "email", label: "E-mail" }, { key: "website", label: "Hjemmeside" },
  { key: "address", label: "Adresse" }, { key: "city", label: "By" },
  { key: "industry", label: "Branche" }, { key: "employee_count", label: "Medarbejdere" },
  { key: "notes", label: "Noter" },
];

function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key, { db: { schema: "nordcall" } }) : null;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Noget gik galt. Prøv igen.");
  return body as T;
}

function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("da-DK", options ?? { day: "numeric", month: "short" }).format(new Date(value));
}
function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes} min ${seconds} sek` : `${seconds} sek`;
}
function friendlyRole(role: string) {
  return role === "admin" ? "Administrator" : "Bruger";
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "S";
}

export function Workspace({ configured, adminEntry = false }: { configured: boolean; adminEntry?: boolean }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot" | "recovery">("login");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [budgetReport, setBudgetReport] = useState<BudgetReport | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(0);
  const [queue, setQueue] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [adminFeedback, setAdminFeedback] = useState<AdminFeedbackMeeting[]>([]);
  const [partnerData, setPartnerData] = useState<PartnerData>({ data: [], campaigns: [] });
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamCampaigns, setTeamCampaigns] = useState<Campaign[]>([]);
  const [teamLeadLists, setTeamLeadLists] = useState<LeadList[]>([]);
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedLeadListId, setSelectedLeadListId] = useState("");
  const [leadListsLoading, setLeadListsLoading] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newLeadListName, setNewLeadListName] = useState("");
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [leadFilters, setLeadFilters] = useState<LeadFilters>({
    city: "", industry: "", employees_min: "", employees_max: "", assigned_user_id: "",
    last_contacted_after: "", callback_after: "",
  });
  const [modal, setModal] = useState<"lead" | "callback" | "meeting" | "invite" | null>(null);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callStartBusy, setCallStartBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<"disconnected" | "connecting" | "ready">("disconnected");
  const [callStarted, setCallStarted] = useState<number | null>(null);
  const [callRecordingEnabled, setCallRecordingEnabled] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [callNote, setCallNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvMapping, setCsvMapping] = useState<Partial<Record<CsvField, string>>>({});
  const [csvProgress, setCsvProgress] = useState(0);
  const [csvErrors, setCsvErrors] = useState<{ row: number; reason: string }[]>([]);
  const [csvBusy, setCsvBusy] = useState(false);
  const [selectedCallbackLead, setSelectedCallbackLead] = useState("");
  const [meetingLeadId, setMeetingLeadId] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingNote, setMeetingNote] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [leadForm, setLeadForm] = useState({ company_name: "", phone: "", contact_person: "", cvr: "", email: "", website: "", address: "", city: "", industry: "", employee_count: "", notes: "" });
  const [leadFormCampaigns, setLeadFormCampaigns] = useState<Campaign[]>([]);
  const [leadFormLists, setLeadFormLists] = useState<LeadList[]>([]);
  const [leadFormCampaignId, setLeadFormCampaignId] = useState("");
  const [leadFormLeadListId, setLeadFormLeadListId] = useState("");
  const [leadFormNewListName, setLeadFormNewListName] = useState("");
  const [leadFormListBusy, setLeadFormListBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const voiceClientRef = useRef<TelnyxClient | null>(null);
  const voiceConnectionPromiseRef = useRef<Promise<TelnyxClient> | null>(null);
  const telnyxCallRef = useRef<TelnyxCall | null>(null);
  const callRecordIdRef = useRef<string | null>(null);
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCallIdRef = useRef<string | null>(null);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const callStatusUpdateRef = useRef<Promise<void>>(Promise.resolve());
  const localAudioStreamRef = useRef<MediaStream | null>(null);

  const loadPageData = useCallback(async (activePage: Page, q = "") => {
    setError("");
    setLoading(true);
    try {
      if (activePage === "dashboard") {
        const [result, budgets, messages, meetingResult, overview] = await Promise.all([
          api<{ data: DashboardData }>("/api/dashboard"),
          api<BudgetReport>("/api/budgets"),
          api<{ data: TeamMessage[] }>("/api/messages"),
          api<{ data: Meeting[] }>("/api/meetings"),
          profile?.role === "admin"
            ? api<{ data: AdminOverview }>("/api/admin/overview")
            : Promise.resolve(null),
        ]);
        setDashboard(result.data);
        setBudgetReport(budgets);
        setTeamMessages(messages.data);
        setMeetings(meetingResult.data);
        if (overview) setAdminOverview(overview.data);
      } else if (activePage === "budget") {
        setBudgetReport(await api<BudgetReport>("/api/budgets"));
      } else if (activePage === "leads") {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (leadStatus) params.set("status", leadStatus);
        params.set("page", String(leadsPage));
        for (const [key, value] of Object.entries(leadFilters)) {
          if (value) params.set(key, value);
        }
        const result = await api<{ data: Lead[]; count: number }>(`/api/leads?${params.toString()}`);
        setLeads(result.data);
        setLeadsTotal(result.count);
        if (profile?.role === "admin") {
          const members = await api<{ data: TeamMember[] }>("/api/team");
          setTeam(members.data);
        }
      } else if (activePage === "dialer") {
        const params = new URLSearchParams();
        if (selectedCampaignId) params.set("campaign_id", selectedCampaignId);
        if (selectedLeadListId) params.set("lead_list_id", selectedLeadListId);
        const result = await api<{ data: Lead[] }>(`/api/leads/queue?${params.toString()}`);
        setQueue(result.data);
        setActiveLead((current) => current && result.data.some((lead) => lead.id === current.id)
          ? current : result.data[0] ?? null);
      } else if (activePage === "callbacks") {
        const result = await api<{ data: Callback[] }>("/api/callbacks");
        setCallbacks(result.data);
      } else if (activePage === "meetings") {
        const result = await api<{ data: Meeting[] }>("/api/meetings");
        setMeetings(result.data);
        // The page still shows the "Ny" markers from this load; they clear on the next one.
        if (result.data.some((meeting) => meeting.feedback?.unseen)) {
          void api("/api/meetings/feedback-seen", { method: "POST" }).catch(() => undefined);
        }
      } else if (activePage === "feedback") {
        const [feedbackResult, campaignResult] = await Promise.all([
          api<{ data: AdminFeedbackMeeting[] }>("/api/admin/meeting-feedback"),
          api<{ data: Campaign[] }>("/api/campaigns"),
        ]);
        setAdminFeedback(feedbackResult.data);
        setCampaigns(campaignResult.data);
      } else if (activePage === "partners") {
        setPartnerData(await api<PartnerData>("/api/admin/partners"));
      } else if (activePage === "history") {
        const result = await api<{ data: Call[] }>("/api/calls");
        setCalls(result.data);
      } else if (activePage === "team") {
        const result = await api<TeamAdminData>("/api/team");
        setTeam(result.data);
        setTeamCampaigns(result.campaigns);
        setTeamLeadLists(result.lead_lists);
        setBudgetReport(await api<BudgetReport>("/api/budgets"));
      } else if (activePage === "messages") {
        const { data } = await api<{ data: TeamMessage[] }>("/api/messages");
        setTeamMessages(data);
      }
    } catch (fetchError) {
      if (activePage === "dialer") {
        setQueue([]);
        setActiveLead(null);
      }
      setError(fetchError instanceof Error ? fetchError.message : "Data kunne ikke indlæses.");
    } finally {
      setLoading(false);
    }
  }, [leadFilters, leadStatus, leadsPage, profile, selectedCampaignId, selectedLeadListId]);

  useEffect(() => {
    if (!user || !profile?.team_id || !["dialer", "import", "messages"].includes(page)) return;
    let alive = true;
    void Promise.all([
      api<{ data: Campaign[] }>("/api/campaigns"),
      page === "messages" && profile.role === "admin" ? api<TeamAdminData>("/api/team") : Promise.resolve(null),
    ]).then(([campaignResult, teamResult]) => {
      if (!alive) return;
      setCampaigns(campaignResult.data);
      setSelectedCampaignId((current) => campaignResult.data.some((campaign) => campaign.id === current) ? current : "");
      if (teamResult) {
        setTeam(teamResult.data);
        setTeamCampaigns(teamResult.campaigns);
        setTeamLeadLists(teamResult.lead_lists);
      }
    }).catch((loadError) => {
      if (alive) setError(loadError instanceof Error ? loadError.message : "Kampagner kunne ikke indlæses.");
    });
    return () => { alive = false; };
  }, [user, profile?.team_id, profile?.role, page]);

  useEffect(() => {
    if (!user || !profile?.team_id || !selectedCampaignId) {
      setLeadLists([]);
      setSelectedLeadListId("");
      setLeadListsLoading(false);
      return;
    }
    let alive = true;
    setLeadListsLoading(true);
    void api<{ data: LeadList[] }>(`/api/campaigns/${selectedCampaignId}/lists`).then(({ data }) => {
      if (!alive) return;
      setLeadLists(data);
      setSelectedLeadListId((current) => data.some((list) => list.id === current) ? current : "");
      setLeadListsLoading(false);
    }).catch((loadError) => {
      if (alive) {
        setLeadListsLoading(false);
        setError(loadError instanceof Error ? loadError.message : "Leadlister kunne ikke indlæses.");
      }
    });
    return () => { alive = false; };
  }, [user, profile?.team_id, selectedCampaignId]);

  useEffect(() => {
    if (modal !== "lead" || !leadFormCampaignId) {
      setLeadFormLists([]);
      setLeadFormLeadListId("");
      return;
    }
    let alive = true;
    void api<{ data: LeadList[] }>(`/api/campaigns/${leadFormCampaignId}/lists`).then(({ data }) => {
      if (!alive) return;
      setLeadFormLists(data);
      setLeadFormLeadListId((current) => data.some((list) => list.id === current) ? current : "");
    }).catch((loadError) => {
      if (alive) setError(loadError instanceof Error ? loadError.message : "Leadlister kunne ikke indlæses.");
    });
    return () => { alive = false; };
  }, [user, profile?.team_id, modal, leadFormCampaignId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("recovery") === "1" || hashParams.get("type") === "recovery") setAuthMode("recovery");
    const authError = params.get("authError") || params.get("error") || hashParams.get("error");
    const errorCode = params.get("error_code") || hashParams.get("error_code");
    if (authError || errorCode) {
      const expired = errorCode === "otp_expired" || errorCode === "access_denied";
      setAuthError(expired
        ? "Bekræftelseslinket er udløbet eller allerede brugt. Send et nyt link nedenfor."
        : "E-mailbekræftelsen kunne ikke gennemføres. Send et nyt link, eller prøv at logge ind.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("recovery")) {
      params.delete("recovery");
      const search = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    }
  }, []);

  useEffect(() => {
    const client = browserSupabase();
    setSupabase(client);
    if (!client) {
      setAuthLoading(false);
      return;
    }
    let alive = true;
    const loadProfile = async (currentUser: User | null) => {
      if (!alive) return;
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setAuthLoading(false);
        return;
      }
      const { data, error: profileError } = await client.from("profiles")
        .select("id, team_id, full_name, role, recordings_enabled, call_recording_enabled, access_mode, can_dial_manual").eq("id", currentUser.id).maybeSingle();
      if (!alive) return;
      if (profileError) {
        console.error("Nordcall profile lookup failed", profileError.code, profileError.message);
        setAuthError(profileError.code === "PGRST106"
          ? "Systemet er ikke klar endnu. Kontakt din administrator."
          : "Brugerprofilen kunne ikke indlæses. Prøv igen, eller kontakt din administrator.");
      } else if (data) {
        // One account can use both links: /admin opens the admin workspace and
        // / shows the same account exactly as a seller sees the system.
        const loaded = data as Profile;
        setProfile(!adminEntry && loaded.role === "admin" ? { ...loaded, role: "salesperson" } : loaded);
      } else {
        // Customer logins have no team profile; send them to their own portal.
        const customerCheck = await fetch("/api/customer/me").catch(() => null);
        if (!alive) return;
        if (customerCheck?.ok) {
          window.location.href = "/kunde";
          return;
        }
        setAuthError("Din konto er bekræftet, men Nordcall-profilen mangler. Opret en Nordcall-konto eller kontakt administratoren.");
      }
      setAuthLoading(false);
    };
    void client.auth.getUser().then(({ data }) => loadProfile(data.user));
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setAuthMode("recovery");
      void loadProfile(session?.user ?? null);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [adminEntry]);

  useEffect(() => {
    if (user && profile?.team_id) void loadPageData(page, search);
  }, [user, profile?.team_id, page, search, leadStatus, loadPageData]);

  useEffect(() => {
    if (!activeCall) return;
    const timer = window.setInterval(() => {
      if (callStarted) setElapsed(Math.max(0, Math.floor((Date.now() - callStarted) / 1000)));
      void api<{ data: Call[] }>("/api/calls").then(({ data }) => {
        const fresh = data.find((call) => call.id === activeCall.id);
        if (fresh) {
          setActiveCall(fresh);
          if (["completed", "busy", "no_answer", "failed", "cancelled"].includes(fresh.status)) setCallStarted(null);
        }
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeCall, callStarted]);

  useEffect(() => () => {
    localAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    stopCallRecording();
    const client = voiceClientRef.current;
    if (client) void client.disconnect().catch((disconnectError: unknown) => {
      console.error("Telnyx WebRTC client could not disconnect", disconnectError);
    });
  }, []);

  async function ensureTelnyxClient() {
    if (voiceClientRef.current?.connected) return voiceClientRef.current;
    if (voiceConnectionPromiseRef.current) return voiceConnectionPromiseRef.current;

    const connectionPromise = (async () => {
      setVoiceState("connecting");
      if (voiceClientRef.current) {
        try {
          await voiceClientRef.current.disconnect();
        } catch (disconnectError) {
          console.error("Stale Telnyx WebRTC client could not disconnect", disconnectError);
        }
        voiceClientRef.current = null;
      }
      const { data: credentials } = await api<{ data: { token: string } }>("/api/calls/webrtc-token", { method: "POST" });
      const { TelnyxRTC } = await import("@telnyx/webrtc");
      const client = new TelnyxRTC({ login_token: credentials.token, hangupOnBeforeUnload: true });
      let ready = false;
      let resolveReady!: () => void;
      let rejectReady!: (reason: Error) => void;
      const readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const connectionTimeout = window.setTimeout(() => {
        rejectReady(new Error("Telefonforbindelsen kunne ikke oprettes. Kontrollér netværket, og prøv igen."));
      }, 20_000);

      client.on("telnyx.ready", () => {
        ready = true;
        setVoiceState("ready");
        resolveReady();
      });
      client.on("telnyx.error", (event) => {
        // Provider error text is logged, never shown to sellers.
        console.error("Phone connection error", event.error);
        const message = "Telefonforbindelsen fejlede. Prøv igen om et øjeblik.";
        if (!ready) rejectReady(new Error(message));
        else setError(message);
      });
      client.on("telnyx.notification", (notification) => {
        const sdkCall = notification.call;
        if (notification.type !== "callUpdate" || !sdkCall || sdkCall.id !== telnyxCallRef.current?.id) return;
        const state = String(sdkCall.state).toLocaleLowerCase();
        const status = ["requesting", "trying", "1", "2"].includes(state) ? "initiated"
          : ["ringing", "4"].includes(state) ? "ringing"
            : ["active", "7"].includes(state) ? "answered"
              : ["hangup", "destroy", "purge", "9", "10", "11"].includes(state) ? "completed" : null;
        const callId = callRecordIdRef.current;
        if (!status || !callId) return;
        if (status === "answered" && profile?.call_recording_enabled) {
          try {
            startCallRecording(callId, sdkCall);
          } catch (recordingError) {
            const message = recordingError instanceof Error ? recordingError.message : "Opkaldsoptagelsen kunne ikke startes.";
            setError(message);
            void sdkCall.hangup().catch((hangupError: unknown) => {
              console.error("Call could not be stopped after recording setup failed", hangupError);
            });
          }
        }
        setActiveCall((current) => current?.id === callId ? { ...current, status } : current);
        if (["completed", "failed", "busy", "no_answer", "cancelled"].includes(status)) {
          stopCallRecording();
          setCallStarted(null);
          localAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
          localAudioStreamRef.current = null;
        }
        callStatusUpdateRef.current = callStatusUpdateRef.current.then(async () => {
          await api(`/api/calls/${callId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
        }).catch((statusError: unknown) => {
          console.error("Could not persist Telnyx call status", statusError);
          setError(statusError instanceof Error ? statusError.message : "Opkaldsstatus kunne ikke gemmes.");
        });
      });

      voiceClientRef.current = client;
      void client.connect().catch((connectionError: unknown) => {
        rejectReady(connectionError instanceof Error ? connectionError : new Error("Telefonforbindelsen kunne ikke oprettes."));
      });
      try {
        await readyPromise;
        return client;
      } catch (connectionError) {
        voiceClientRef.current = null;
        setVoiceState("disconnected");
        try {
          await client.disconnect();
        } catch (disconnectError) {
          console.error("Telnyx WebRTC client cleanup failed", disconnectError);
        }
        throw connectionError;
      } finally {
        window.clearTimeout(connectionTimeout);
      }
    })();
    voiceConnectionPromiseRef.current = connectionPromise;
    try {
      return await connectionPromise;
    } catch (connectionError) {
      setVoiceState("disconnected");
      throw connectionError;
    } finally {
      voiceConnectionPromiseRef.current = null;
    }
  }

  function startCallRecording(callId: string, sdkCall: TelnyxCall) {
    if (recordingCallIdRef.current === callId) return;
    if (!window.MediaRecorder) throw new Error("Denne browser understøtter ikke sikker samtaleoptagelse. Brug Chrome eller Edge.");
    const localStream = sdkCall.localStream;
    const remoteStream = sdkCall.remoteStream;
    if (!localStream?.getAudioTracks().length || !remoteStream?.getAudioTracks().length) {
      throw new Error("Opkaldets lydspor er ikke klar til optagelse. Opkaldet afsluttes uden at blive gemt.");
    }
    const audioContext = new AudioContext();
    const mixedAudio = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(localStream).connect(mixedAudio);
    audioContext.createMediaStreamSource(remoteStream).connect(mixedAudio);
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      void audioContext.close();
      throw new Error("Browseren understøtter ikke et sikkert lydformat til optagelsen.");
    }
    const recorder = new MediaRecorder(mixedAudio.stream, { mimeType });
    recordingCallIdRef.current = callId;
    recordingAudioContextRef.current = audioContext;
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onerror = (event) => {
      console.error("Browser call recording failed", event);
      setError("Opkaldet blev gennemført, men browseren kunne ikke optage lyden.");
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
      recordingChunksRef.current = [];
      callRecorderRef.current = null;
      recordingCallIdRef.current = null;
      void (async () => {
        if (!blob.size) throw new Error("Opkaldet sluttede uden en brugbar optagelse.");
        const contentType = blob.type.split(";")[0];
        const { data: upload } = await api<{ data: { path: string; token: string; content_type: string } }>(`/api/calls/${callId}/recording`, {
          method: "POST",
          body: JSON.stringify({ action: "prepare", content_type: contentType }),
        });
        const storageClient = supabase ?? browserSupabase();
        if (!storageClient) throw new Error("Optagelsen kunne ikke gemmes lige nu.");
        const { error: uploadError } = await storageClient.storage.from("call-recordings")
          .uploadToSignedUrl(upload.path, upload.token, blob, { contentType: upload.content_type });
        if (uploadError) {
          console.error("Recording upload failed", uploadError.message);
          throw new Error("Optagelsen kunne ikke gemmes sikkert.");
        }
        await api(`/api/calls/${callId}/recording`, {
          method: "POST",
          body: JSON.stringify({ action: "finalize", path: upload.path }),
        });
        setNotice("Opkaldsoptagelsen er gemt sikkert til administratoren.");
      })().catch((uploadError: unknown) => {
        console.error("Call recording upload failed", uploadError);
        setError(uploadError instanceof Error ? uploadError.message : "Opkaldsoptagelsen kunne ikke gemmes.");
      }).finally(() => {
        if (recordingAudioContextRef.current === audioContext) recordingAudioContextRef.current = null;
        void audioContext.close().catch((closeError: unknown) => {
          console.error("Call recording audio context could not close", closeError);
        });
      });
    };
    recorder.start(1000);
    callRecorderRef.current = recorder;
  }

  function stopCallRecording() {
    const recorder = callRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function startWebRtcCall(phone: string, leadId?: string) {
    callRecordIdRef.current = null;
    telnyxCallRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Denne browser kan ikke bruge mikrofonen. Åbn Nordcall via HTTPS i en understøttet browser.");
    }
    if (profile?.call_recording_enabled && !window.MediaRecorder) {
      throw new Error("Denne browser understøtter ikke samtaleoptagelse. Brug Chrome eller Edge, eller bed administratoren om hjælp.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    localAudioStreamRef.current = stream;
    try {
      const client = await ensureTelnyxClient();
      const result = await api<{ data: Call }>("/api/calls/start", {
        method: "POST",
        body: JSON.stringify(leadId ? { lead_id: leadId } : { phone }),
      });
      callRecordIdRef.current = result.data.id;
      setActiveCall(result.data);
      setCallStarted(Date.now());
      setElapsed(0);
      if (!client.connected) throw new Error("Telefonforbindelsen blev afbrudt. Prøv at ringe igen.");
      // The server picks the caller number from the campaign or team default.
      if (!result.data.caller_number) throw new Error("Der er ikke tildelt et udgående nummer. Kontakt din administrator.");
      telnyxCallRef.current = client.newCall({
        destinationNumber: result.data.phone,
        callerNumber: result.data.caller_number,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        localStream: stream,
        ...(remoteAudioRef.current ? { remoteElement: remoteAudioRef.current } : {}),
      });
      return result.data;
    } catch (startError) {
      stream.getTracks().forEach((track) => track.stop());
      localAudioStreamRef.current = null;
      if (callRecordIdRef.current) {
        try {
          await api("/api/calls/end", {
            method: "POST",
            body: JSON.stringify({ call_id: callRecordIdRef.current, outcome: "failed" }),
          });
        } catch (recordError) {
          console.error("Failed WebRTC call could not be marked as ended", recordError);
        }
      }
      callRecordIdRef.current = null;
      telnyxCallRef.current = null;
      setActiveCall(null);
      setCallStarted(null);
      throw startError;
    }
  }

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
        if (!email) throw new Error("Skriv din e-mailadresse først.");
        const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
        const appUrl = configuredAppUrl?.startsWith("https://") ? configuredAppUrl : window.location.origin;
        const returnPath = window.location.pathname === "/admin" ? "/admin" : "/";
        const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(returnPath)}&recovery=1`,
        });
        if (recoveryError) throw recoveryError;
        setAuthMessage("Hvis adressen findes, har vi sendt et link til nulstilling. Tjek også spam-mappen.");
      } else if (authMode === "recovery") {
        const confirmation = String(form.get("password_confirmation") ?? "");
        if (password.length < 8) throw new Error("Adgangskoden skal være mindst 8 tegn.");
        if (password !== confirmation) throw new Error("Adgangskoderne er ikke ens.");
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) console.error("Could not sign out after password recovery", signOutError.message);
        setUser(null);
        setProfile(null);
        setAuthMode("login");
        setAuthMessage("Adgangskoden er ændret. Du kan nu logge ind.");
      } else if (authMode === "signup") {
        const fullName = String(form.get("full_name") ?? "").trim();
        const teamName = String(form.get("team_name") ?? "").trim();
        if (!fullName || !teamName) throw new Error("Udfyld dit navn og teamets navn.");
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, nordcall_app: true },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setAuthMessage("Bekræft din e-mail via linket, vi har sendt. Log derefter ind for at oprette dit team.");
        } else {
          const { error: teamError } = await supabase.rpc("create_team_for_current_user", { team_name: teamName });
          if (teamError) throw teamError;
          setAuthMessage("Dit team er oprettet — velkommen til Nordcall.");
          setUser(data.user);
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) {
          if (loginError.message.toLowerCase().includes("email not confirmed")) {
            throw new Error("Bekræft din e-mail før login. Du kan sende et nyt bekræftelseslink nedenfor.");
          }
          throw loginError;
        }
      }
    } catch (submitError) {
      setAuthError(submitError instanceof Error ? submitError.message : "Login mislykkedes. Prøv igen.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!supabase || !authEmail.trim()) {
      setAuthError("Skriv din e-mailadresse, så sender vi et nyt bekræftelseslink.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: authEmail.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (resendError) throw resendError;
      setAuthMessage("Hvis adressen har en uafsluttet tilmelding, sender vi et nyt link. Tjek også spam-mappen.");
    } catch (resendError) {
      setAuthError(resendError instanceof Error ? resendError.message : "Kunne ikke sende et nyt link. Prøv igen.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    if (!supabase) return;
    try {
      if (telnyxCallRef.current) await telnyxCallRef.current.hangup();
      if (voiceClientRef.current) await voiceClientRef.current.disconnect();
    } catch (disconnectError) {
      console.error("Telnyx call cleanup during logout failed", disconnectError);
      setError("Opkaldet kunne ikke afsluttes sikkert. Prøv igen om et øjeblik.");
      return;
    }
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) setError("Du blev ikke logget ud. Prøv igen.");
    else {
      setUser(null);
      setProfile(null);
    }
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    const form = new FormData(event.currentTarget);
    const teamName = String(form.get("team_name") ?? "").trim();
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error: teamError } = await supabase.rpc("create_team_for_current_user", { team_name: teamName });
      if (teamError) throw teamError;
      const { data, error: profileError } = await supabase.from("profiles")
        .select("id, team_id, full_name, role, recordings_enabled, call_recording_enabled, access_mode, can_dial_manual").eq("id", user.id).single();
      if (profileError) throw new Error("Dit team blev oprettet, men profilen kunne ikke indlæses. Genindlæs siden.");
      setProfile(data as Profile);
    } catch (teamError) {
      setAuthError(teamError instanceof Error ? teamError.message : "Teamet kunne ikke oprettes. Prøv igen.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function openPlanner(kind: "callback" | "meeting") {
    setModal(kind);
    if (!leads.length) {
      try {
        const result = await api<{ data: Lead[] }>("/api/leads");
        setLeads(result.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Virksomheder kunne ikke indlæses.");
      }
    }
  }

  function exportCsv(records: object[], filename: string) {
    if (!records.length) {
      setError("Der er ingen data at eksportere.");
      return;
    }
    const mappedRows = records.map((record) => new Map(Object.entries(record)));
    const columns = Array.from(new Set(mappedRows.flatMap((record) => Array.from(record.keys()))));
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const content = [columns.map(quote).join(";"), ...mappedRows.map((record) => columns.map((column) => quote(record.get(column))).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setInviteError("");
    try {
      await api("/api/team/invite", { method: "POST", body: JSON.stringify({
        full_name: String(form.get("full_name") ?? ""),
        email: String(form.get("email") ?? ""),
      }) });
      setModal(null);
      setNotice("Invitationen er sendt.");
      void loadPageData("team");
    } catch (inviteFailure) {
      setInviteError(inviteFailure instanceof Error ? inviteFailure.message : "Invitationen kunne ikke sendes.");
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await api("/api/team", { method: "PATCH", body: JSON.stringify({ user_id: userId, role }) });
      setNotice("Teamrollen er opdateret.");
      void loadPageData("team");
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Rollen kunne ikke ændres.");
    }
  }

  async function openLeadModal() {
    setModal("lead");
    try {
      const { data } = await api<{ data: Campaign[] }>("/api/campaigns");
      setLeadFormCampaigns(data);
      const preferred = data.find((campaign) => campaign.id === selectedCampaignId) ?? data[0];
      setLeadFormCampaignId(preferred?.id ?? "");
      setLeadFormLeadListId("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kampagner kunne ikke indlæses.");
    }
  }

  async function createLeadFormList() {
    if (!leadFormCampaignId || leadFormNewListName.trim().length < 2) {
      setError("Vælg en kampagne, og angiv et navn på mindst 2 tegn til leadlisten.");
      return;
    }
    setLeadFormListBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: LeadList }>(`/api/campaigns/${leadFormCampaignId}/lists`, {
        method: "POST",
        body: JSON.stringify({ name: leadFormNewListName }),
      });
      setLeadFormLists((current) => [data, ...current]);
      setLeadFormLeadListId(data.id);
      setLeadFormNewListName("");
      setNotice("Leadlisten er oprettet under den valgte kampagne.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Leadlisten kunne ikke oprettes.");
    } finally {
      setLeadFormListBusy(false);
    }
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/api/leads", { method: "POST", body: JSON.stringify({
        ...leadForm,
        employee_count: leadForm.employee_count ? Number(leadForm.employee_count) : null,
        campaign_id: leadFormCampaignId,
        ...(leadFormLeadListId ? { lead_list_id: leadFormLeadListId } : {}),
      }) });
      setModal(null);
      setLeadForm({ company_name: "", phone: "", contact_person: "", cvr: "", email: "", website: "", address: "", city: "", industry: "", employee_count: "", notes: "" });
      setLeadFormCampaignId("");
      setLeadFormLeadListId("");
      setNotice("Virksomheden er oprettet.");
      void loadPageData(page, search);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Virksomheden kunne ikke oprettes.");
    }
  }

  async function saveBudget(userId: string, campaignId: string | null, weekly: number, monthly: number) {
    try {
      await api("/api/budgets", {
        method: "PUT",
        body: JSON.stringify({ user_id: userId, campaign_id: campaignId, weekly_target: weekly, monthly_target: monthly }),
      });
      setNotice("Budgetmålet er gemt.");
      const refreshPage = page === "team" ? "team" : "dashboard";
      void loadPageData(refreshPage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Budgetmålet kunne ikke gemmes.");
    }
  }

  async function saveCampaignBudget(userId: string, campaignId: string, settings: CampaignBudgetSettings) {
    try {
      await api("/api/budgets", {
        method: "PUT",
        body: JSON.stringify({ user_id: userId, campaign_id: campaignId, ...settings }),
      });
      setNotice("Budget og provisionsaftale er gemt.");
      setBudgetReport(await api<BudgetReport>("/api/budgets"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Budget og provision kunne ikke gemmes.");
    }
  }

  async function recordBudgetEvent(campaignId: string, eventType: "meeting" | "sale") {
    try {
      await api("/api/budgets", {
        method: "POST",
        body: JSON.stringify({ campaign_id: campaignId, event_type: eventType }),
      });
      setNotice(eventType === "meeting" ? "Mødet er registreret i dit budget." : "Salget er registreret i dit budget.");
      setBudgetReport(await api<BudgetReport>("/api/budgets"));
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : "Aktiviteten kunne ikke registreres.");
    }
  }

  async function sendTeamMessage(input: { title: string; body: string; scope: string; campaign_id?: string; lead_list_id?: string }) {
    try {
      const result = await api<{ sent: number }>("/api/messages", {
        method: "POST", body: JSON.stringify(input),
      });
      setNotice(`Beskeden blev sendt til ${result.sent} teammedlemmer.`);
      void loadPageData("messages");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Beskeden kunne ikke sendes.");
      throw sendError;
    }
  }

  async function markMessageRead(messageId: string) {
    try {
      await api(`/api/messages/${messageId}`, { method: "PATCH" });
      setTeamMessages((current) => current.map((message) =>
        message.id === messageId ? { ...message, read_at: new Date().toISOString() } : message,
      ));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Beskeden kunne ikke markeres som læst.");
    }
  }

  async function updateLead(id: string, update: Record<string, unknown>) {
    try {
      await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(update) });
      setNotice("Ændringerne er gemt.");
      void loadPageData(page, search);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Virksomheden kunne ikke opdateres.");
    }
  }

  async function deleteLead(id: string, companyName: string) {
    if (!window.confirm(`Slet ${companyName}? Virksomhedens opkaldshistorik og noter slettes også.`)) return;
    try {
      await api(`/api/leads/${id}`, { method: "DELETE" });
      setLeads((current) => current.filter((lead) => lead.id !== id));
      setLeadsTotal((current) => Math.max(0, current - 1));
      setNotice("Virksomheden og tilknyttede data er slettet.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Virksomheden kunne ikke slettes.");
    }
  }

  async function beginCall() {
    if (!activeLead) return;
    if (profile?.call_recording_enabled
      && !window.confirm("Dette opkald optages, fordi administratoren har aktiveret optagelse for din konto. Bekræft, at du har informeret deltageren, før du fortsætter.")) return;
    setCallStartBusy(true);
    setError("");
    try {
      await startWebRtcCall(activeLead.phone, activeLead.id);
      setQueue((current) => current.filter((lead) => lead.id !== activeLead.id));
      setNotice("Headsettet er forbundet. Opkaldet starter.");
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Opkaldet kunne ikke startes.");
    } finally {
      setCallStartBusy(false);
    }
  }

  async function beginManualCall() {
    const phone = manualPhone.trim();
    if (!phone) {
      setError("Indtast et telefonnummer.");
      return;
    }
    if (profile?.call_recording_enabled
      && !window.confirm("Dette opkald optages, fordi administratoren har aktiveret optagelse for din konto. Bekræft, at du har informeret deltageren, før du fortsætter.")) return;
    setCallStartBusy(true);
    setError("");
    try {
      await startWebRtcCall(phone);
      setActiveLead(null);
      setNotice("Headsettet er forbundet. Opkaldet starter.");
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Opkaldet kunne ikke startes.");
    } finally {
      setCallStartBusy(false);
    }
  }

  async function createDialerLead(input: { company_name: string; phone: string; contact_person: string; notes: string }): Promise<boolean> {
    if (!selectedCampaignId) {
      setError("Vælg en tildelt kampagne, før du opretter et lead.");
      return false;
    }
    if (!window.confirm(`Opret ${input.company_name.trim()} på den valgte leadliste?`)) return false;
    try {
      const { data } = await api<{ data: Lead }>("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          campaign_id: selectedCampaignId,
          ...(selectedLeadListId ? { lead_list_id: selectedLeadListId } : {}),
        }),
      });
      setActiveLead(data);
      setQueue((current) => [data, ...current.filter((lead) => lead.id !== data.id)]);
      setNotice("Leadet er oprettet og tilføjet til opkaldskøen.");
      return true;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Leadet kunne ikke oprettes.");
      return false;
    }
  }

  async function finishCall(outcome: string) {
    if (!activeCall) return;
    if (outcome === "callback" && !callbackAt) {
      setError("Vælg dato og tidspunkt for callback.");
      return;
    }
    setOutcomeBusy(true);
    setError("");
    try {
      if (activeCall.status !== "completed" && activeCall.status !== "busy" && activeCall.status !== "failed"
        && activeCall.status !== "no_answer" && activeCall.status !== "cancelled" && telnyxCallRef.current) {
        await telnyxCallRef.current.hangup();
      }
      await api("/api/calls/end", {
        method: "POST",
        body: JSON.stringify({
          call_id: activeCall.id,
          outcome,
          notes: callNote,
          callback_at: outcome === "callback" && callbackAt ? new Date(callbackAt).toISOString() : undefined,
        }),
      });
      setNotice("Opkald og resultat er gemt.");
      setActiveCall(null);
      setCallStarted(null);
      setCallNote("");
      setCallbackAt("");
      callRecordIdRef.current = null;
      telnyxCallRef.current = null;
      localAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
      localAudioStreamRef.current = null;
      if (!activeCall.lead_id) {
        setActiveLead(queue[0] ?? null);
        return;
      }
      const remaining = queue.filter((lead) => lead.id !== activeLead?.id);
      setQueue(remaining);
      setActiveLead(remaining[0] ?? null);
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Resultatet kunne ikke gemmes.");
    } finally {
      setOutcomeBusy(false);
    }
  }

  function advanceLead() {
    const remaining = queue.filter((lead) => lead.id !== activeLead?.id);
    setQueue(remaining);
    setActiveLead(remaining[0] ?? null);
  }

  async function completeCallback(id: string) {
    try {
      await api(`/api/callbacks/${id}`, { method: "PATCH" });
      setCallbacks((current) => current.filter((callback) => callback.id !== id));
      setNotice("Callback markeret som gennemført.");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Callback kunne ikke opdateres.");
    }
  }

  function readCsv(file?: File) {
    if (!file) return;
    setCsvBusy(true);
    setCsvErrors([]);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        if (result.data.length > 10_000) {
          setError("CSV-filen er for stor. Importér højst 10.000 rækker ad gangen.");
          setCsvHeaders([]);
          setCsvRows([]);
          setCsvBusy(false);
          return;
        }
        if (result.errors.length) setError(`CSV-filen har ${result.errors.length} formatfejl. Kontrollér filen før import.`);
        setCsvHeaders(result.meta.fields ?? []);
        setCsvRows(result.data);
        const mapping: Partial<Record<CsvField, string>> = {};
        for (const field of csvFields) {
          const match = result.meta.fields?.find((header) => header.toLocaleLowerCase("da-DK") === field.label.toLocaleLowerCase("da-DK")
            || header.toLocaleLowerCase("da-DK") === field.key.toLocaleLowerCase("da-DK"));
          if (match) mapping[field.key] = match;
        }
        setCsvMapping(mapping);
        setCsvBusy(false);
      },
      error: (parseError) => {
        setError(parseError.message);
        setCsvBusy(false);
      },
    });
  }

  async function importCsv() {
    if (!csvRows.length || !csvMapping.company_name || !csvMapping.phone) {
      setError("Vælg kolonner for virksomhed og telefonnummer før import.");
      return;
    }
    if (!selectedCampaignId || !selectedLeadListId) {
      setError("Vælg eller opret en kampagne og leadliste før import.");
      return;
    }
    setCsvBusy(true);
    setCsvProgress(0);
    setCsvErrors([]);
    let imported = 0;
    const allErrors: { row: number; reason: string }[] = [];
    const chunkSize = 250;
    try {
      for (let offset = 0; offset < csvRows.length; offset += chunkSize) {
        const response = await fetch("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: csvRows.slice(offset, offset + chunkSize),
            mapping: csvMapping,
            row_offset: offset,
            lead_list_id: selectedLeadListId,
          }),
        });
        const result = await response.json().catch(() => null) as {
          imported?: number;
          errors?: { row: number; reason: string }[];
          error?: string;
        } | null;
        if (!response.ok) {
          imported += result?.imported ?? 0;
          allErrors.push(...(result?.errors ?? []));
          setCsvErrors(allErrors);
          if (imported > 0) setNotice(`${imported} virksomheder blev importeret, før importen blev stoppet.`);
          setError(result?.error ?? "Importen blev stoppet. Kontrollér fejlene, før du prøver igen.");
          void loadPageData("leads");
          return;
        }
        if (typeof result?.imported !== "number" || !Array.isArray(result.errors)) {
          throw new Error("Importserveren returnerede et ugyldigt svar.");
        }
        imported += result.imported;
        allErrors.push(...result.errors);
        setCsvProgress(Math.min(100, Math.round(((offset + chunkSize) / csvRows.length) * 100)));
      }
      setCsvErrors(allErrors);
      setNotice(`${imported} virksomheder importeret. ${allErrors.length} rækker kræver kontrol.`);
      void loadPageData("leads");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Importen fejlede.");
    } finally {
      setCsvBusy(false);
    }
  }

  async function createCampaign() {
    setCampaignBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name: newCampaignName }),
      });
      setCampaigns((current) => [data, ...current]);
      setSelectedCampaignId(data.id);
      setSelectedLeadListId("");
      setNewCampaignName("");
      setNotice("Kampagnen er oprettet.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Kampagnen kunne ikke oprettes.");
    } finally {
      setCampaignBusy(false);
    }
  }

  async function createLeadList() {
    if (!selectedCampaignId) {
      setError("Vælg en kampagne først.");
      return;
    }
    setCampaignBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: LeadList }>(`/api/campaigns/${selectedCampaignId}/lists`, {
        method: "POST",
        body: JSON.stringify({ name: newLeadListName }),
      });
      setLeadLists((current) => [data, ...current]);
      setSelectedLeadListId(data.id);
      setNewLeadListName("");
      setNotice("Leadlisten er oprettet i kampagnen.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Leadlisten kunne ikke oprettes.");
    } finally {
      setCampaignBusy(false);
    }
  }

  async function addCallback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/callbacks", { method: "POST", body: JSON.stringify({
        lead_id: selectedCallbackLead,
        callback_at: new Date(String(form.get("callback_at"))).toISOString(),
        notes: String(form.get("notes") ?? ""),
      }) });
      setModal(null);
      setNotice("Callback er planlagt.");
      void loadPageData("callbacks");
    } catch (callbackError) {
      setError(callbackError instanceof Error ? callbackError.message : "Callback kunne ikke oprettes.");
    }
  }

  // Dialogs show their own errors, so failures are rethrown after the toast.
  async function partnerAction(url: string, method: string, body: unknown, success: string) {
    try {
      await api(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setNotice(success);
      void loadPageData("partners");
    } catch (actionError) {
      if (method === "DELETE" || method === "PATCH") setError(actionError instanceof Error ? actionError.message : "Handlingen mislykkedes.");
      throw actionError;
    }
  }

  async function addMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/meetings", { method: "POST", body: JSON.stringify({
        lead_id: meetingLeadId,
        meeting_at: new Date(meetingDate).toISOString(),
        meeting_type: String(form.get("meeting_type") ?? "online"),
        notes: meetingNote,
        ...(profile?.role === "admin" ? { calendar_url: String(form.get("calendar_url") ?? "") } : {}),
      }) });
      setModal(null);
      setNotice("Mødet er booket.");
      void loadPageData("meetings");
    } catch (meetingError) {
      setError(meetingError instanceof Error ? meetingError.message : "Mødet kunne ikke bookes.");
    }
  }

  const filteredLeads = useMemo(() => leads.filter((lead) => !search
    || [lead.company_name, lead.contact_person ?? "", lead.phone, lead.cvr ?? ""].some((field) => field.toLocaleLowerCase("da-DK").includes(search.toLocaleLowerCase("da-DK")))), [leads, search]);
  function updateLeadFilters(filters: LeadFilters) {
    setLeadFilters(filters);
    setLeadsPage(0);
  }
  function updateLeadStatus(status: string) {
    setLeadStatus(status);
    setLeadsPage(0);
  }
  const greeting = profile?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "der";

  if (authLoading) {
    return <div className="auth-screen"><div className="loading-orbit" /><p>Gør dit salgsteam klar …</p></div>;
  }

  if (configured && authMode === "recovery") {
    return <div className="auth-screen"><div className="auth-glow" /><div className="auth-card">
      <Brand /><div className="auth-heading"><span className="eyebrow">KONTOGENDANNELSE</span><h1>Vælg en ny adgangskode</h1><p>Brug mindst 8 tegn.</p></div>
      <form className="auth-form" onSubmit={submitAuth}>
        <label>Ny adgangskode<input name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="Mindst 8 tegn" /></label>
        <label>Gentag adgangskode<input name="password_confirmation" type="password" autoComplete="new-password" required minLength={8} placeholder="Gentag adgangskoden" /></label>
        {authError && <p className="form-error">{authError}</p>}
        {authMessage && <p className="form-success">{authMessage}</p>}
        <button className="button button-primary button-wide" disabled={authBusy}>{authBusy ? "Gemmer …" : "Gem ny adgangskode"} <ArrowRight size={16} /></button>
      </form>
    </div><div className="auth-caption">Bygget til gode samtaler. <span>Designed in Copenhagen.</span></div></div>;
  }

  if (adminEntry && user && profile && (profile.role !== "admin" || !profile.team_id)) {
    return <div className="auth-screen"><div className="auth-glow" /><div className="auth-card">
      <Brand /><div className="auth-heading"><span className="eyebrow">ADMINISTRATORADGANG</span><h1>Du har ikke adgang</h1><p>Brug en administrator konto med et aktivt team til /admin.</p></div>
      <button className="button button-secondary button-wide" onClick={() => { window.location.href = "/"; }}>Gå til brugerlogin</button>
      <button className="text-button auth-resend" onClick={() => void logout()}>Log ud</button>
    </div><div className="auth-caption">Adgang styres af din kontos rolle, ikke af URL&apos;en.</div></div>;
  }

  if (configured && user && profile && !profile.team_id) {
    return <div className="auth-screen"><div className="auth-glow" /><div className="auth-card">
      <Brand /><div className="auth-heading"><span className="eyebrow">NÆSTEN KLAR</span><h1>Giv dit team et navn</h1><p>Du bliver administrator for din nye arbejdsplads.</p></div>
      <form className="auth-form" onSubmit={createTeam}><label>Teamets navn<input name="team_name" required minLength={2} maxLength={100} placeholder="F.eks. Nordisk Vækst" /></label>
        {authError && <p className="form-error">{authError}</p>}<button className="button button-primary button-wide" disabled={authBusy}>{authBusy ? "Opretter …" : "Opret mit team"} <ArrowRight size={16} /></button></form>
      <div className="auth-privacy"><CheckCircle2 size={15} /> Dit team er privat og sikkert</div>
    </div><div className="auth-caption">Bygget til gode samtaler. <span>Designed in Copenhagen.</span></div></div>;
  }

  if (!configured || !user || !profile?.team_id) {
    return (
      <div className="auth-screen">
        <div className="auth-glow" />
        <div className="auth-card">
          <Brand />
          {!configured ? (
            <div className="setup-block">
              <span className="setup-icon"><Settings2 size={22} /></span>
              <span className="eyebrow">KOM GODT I GANG</span>
              <h1>Dit salgsteam.<br /><span>Ét bedre flow.</span></h1>
              <p>Systemet er ved at blive sat op. Kontakt din administrator, hvis du ikke kan logge ind.</p>
            </div>
          ) : (
            <>
              <div className="auth-heading">
                <span className="eyebrow">{authMode === "signup" ? "DIT NÆSTE SALG STARTER HER" : authMode === "forgot" ? "KONTOGENDANNELSE" : adminEntry ? "SIKKER ADMINISTRATORADGANG" : "VELKOMMEN TILBAGE"}</span>
                <h1>{authMode === "signup" ? "Opret dit salgsteam" : authMode === "forgot" ? "Nulstil adgangskode" : adminEntry ? "Administratorlogin" : "Log ind på Nordcall"}</h1>
                <p>{authMode === "signup" ? "Start med en sikker arbejdsplads til dit team." : authMode === "forgot" ? "Vi sender et sikkert link til din e-mailadresse." : adminEntry ? "Log ind med en administrator konto." : "Dit team venter på dig."}</p>
              </div>
              <form className="auth-form" onSubmit={submitAuth}>
                {authMode === "signup" && !adminEntry && <>
                  <label>Dit navn<input name="full_name" autoComplete="name" required placeholder="F.eks. Emma Jensen" /></label>
                  <label>Teamets navn<input name="team_name" required minLength={2} placeholder="F.eks. Nordisk Vækst" /></label>
                </>}
                <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="dig@virksomhed.dk" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
                {authMode !== "forgot" && <label>Adgangskode<input name="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength={8} placeholder="Mindst 8 tegn" /></label>}
                {authError && <p className="form-error">{authError}</p>}
                {authMessage && <p className="form-success">{authMessage}</p>}
                {authMode === "login" && <>
                  <button type="button" className="text-button auth-resend" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthMessage(""); }} disabled={authBusy}>Glemt adgangskode?</button>
                  <button type="button" className="text-button auth-resend" onClick={() => void resendConfirmation()} disabled={authBusy}>{authBusy ? "Sender nyt link …" : "Send nyt bekræftelseslink"}</button>
                </>}
                <button className="button button-primary button-wide" disabled={authBusy}>{authBusy ? "Et øjeblik …" : authMode === "signup" ? "Opret team" : authMode === "forgot" ? "Send nulstillingslink" : "Log ind"} <ArrowRight size={16} /></button>
              </form>
              {!adminEntry && (authMode === "login" || authMode === "signup")
                ? <div className="auth-switch">{authMode === "login" ? "Nyt på Nordcall?" : "Har du allerede en konto?"}
                  <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); setAuthMessage(""); }}>{authMode === "login" ? "Opret et team" : "Log ind"}</button>
                </div>
                : <div className="auth-switch"><button onClick={() => { window.location.href = adminEntry ? "/" : "/admin"; }}>{adminEntry ? "Brugerlogin" : "Adminlogin"}</button></div>}
              <div className="auth-privacy"><CheckCircle2 size={15} /> Data forbliver under dit teams adgangskontrol</div>
            </>
          )}
        </div>
        <div className="auth-caption">Bygget til gode samtaler. <span>Designed in Copenhagen.</span></div>
      </div>
    );
  }

  const pageTitle: Record<Page, string> = {
    dashboard: "Overblik", budget: "Budget", leads: "Virksomheder", dialer: "Opkald", dialpad: "Dialpad", callbacks: "Callbacks",
    meetings: "Møder", history: "Opkaldshistorik", import: "Importer leads", team: "Dit team", partners: "Samarbejdspartnere", feedback: "Mødefeedback", earnings: "Godkend indtjening", numbers: "Telefonnumre", game: "Magnora Empire",
    messages: "Beskeder", settings: "Indstillinger",
  };
  const unreadMessages = teamMessages.filter((message) =>
    message.recipient_user_id === user.id && !message.read_at,
  ).length;
  const unseenFeedback = meetings.filter((meeting) => meeting.feedback?.unseen).length;

  return (
    <div className="app-shell">
      <audio ref={remoteAudioRef} autoPlay playsInline aria-hidden="true" style={{ display: "none" }} />
      {mobileNav && <button className="mobile-scrim" aria-label="Luk menu" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><Brand compact /></div>
        <div className="workspace-switch">
          <div className="workspace-mark">{initials(profile.full_name || "Nordcall")}</div>
          <div className="workspace-copy"><strong>{profile.full_name ? `${profile.full_name.split(" ")[0]}s team` : "Dit salgsteam"}</strong><span>{friendlyRole(profile.role)}</span></div>
          <ChevronDown size={15} />
        </div>
        <nav className="side-nav" aria-label="Hovednavigation">
          {navGroups.map((group) => {
            const items = group.items.filter((item) =>
              (item.id !== "import" || profile.role === "admin")
              && (item.id !== "leads" || profile.role !== "salesperson")
              && (item.id !== "team" || profile.role === "admin")
              && (item.id !== "dialpad" || profile.role === "admin" || profile.can_dial_manual !== false)
              && (!["partners", "feedback", "earnings", "numbers"].includes(item.id) || profile.role === "admin"));
            return items.length ? <div className="nav-group" key={group.label}>
            <span className="nav-label">{group.label}</span>
            {items.map(({ id, title, icon: Icon }) => (
              <button key={id} className={`nav-item ${page === id ? "nav-active" : ""}`} onClick={() => { setPage(id); setMobileNav(false); }}>
                <Icon size={17} strokeWidth={1.8} /><span>{title}</span>
                {id === "callbacks" && dashboard?.callbacks ? <span className="nav-count">{dashboard.callbacks}</span> : null}
                {id === "meetings" && unseenFeedback ? <span className="nav-count nav-count-alert" aria-label={`${unseenFeedback} ny feedback`}>{unseenFeedback}</span> : null}
              </button>
            ))}
          </div> : null;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><CircleHelp size={16} /></span><strong>Har du brug for en hånd?</strong><span>Vi er lige her, når du har brug for os.</span><a href="mailto:hej@nordcall.dk">Skriv til support <ArrowUpRight size={13} /></a></div>
          <button className="profile-row" onClick={logout}>
            <div className="avatar">{initials(profile.full_name || user.email || "S")}</div>
            <span className="profile-copy"><strong>{profile.full_name || user.email}</strong><small>{user.email}</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Åbn menu"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{pageTitle[page]}</strong></div>
          <div className="topbar-actions">
            <div className="global-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setLeadsPage(0); }} placeholder="Søg virksomheder, kontakt …" /><kbd>⌘ K</kbd></div>
            <button className="icon-button notification-button" aria-label={unseenFeedback ? `${unseenFeedback} ny feedback på dine møder` : `Beskeder${unreadMessages ? `, ${unreadMessages} ulæste` : ""}`} onClick={() => setPage(unseenFeedback ? "meetings" : "messages")}>
              <Bell size={17} />{(unreadMessages > 0 || unseenFeedback > 0) && <i />}
            </button>
            <div className="topbar-divider" />
            <div className="topbar-avatar">{initials(profile.full_name || user.email || "S")}</div>
          </div>
        </header>
        <div className="page-content">
          {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role="status"><span>{error || notice}</span><button aria-label="Luk besked" onClick={() => { setError(""); setNotice(""); }}><X size={16} /></button></div>}
          {page === "dashboard" && <DashboardView
            data={dashboard} loading={loading} name={greeting} role={profile.role} userId={user.id}
            budgets={budgetReport} setPage={setPage} onNewLead={() => void openLeadModal()} onSaveBudget={saveBudget}
          />}
          {page === "dashboard" && <SellerFeedbackPanel meetings={meetings.filter((meeting) => meeting.user_id === user.id)} onOpenMeetings={() => setPage("meetings")} />}
          {page === "dashboard" && profile.role === "admin" && adminOverview
            && <AdminCampaignOverview overview={adminOverview} onManageTeam={() => setPage("team")} />}
          {page === "budget" && <BudgetView
            report={budgetReport} loading={loading} userId={user.id} role={profile.role}
            onSave={saveCampaignBudget} onRecord={recordBudgetEvent}
          />}
          {page === "leads" && profile.role !== "salesperson" && <LeadsView leads={filteredLeads} total={leadsTotal} page={leadsPage} onPage={setLeadsPage} loading={loading} status={leadStatus} setStatus={updateLeadStatus} filters={leadFilters} setFilters={updateLeadFilters} members={team} profile={profile} onAdd={() => void openLeadModal()} onUpdate={updateLead} onDelete={deleteLead} onExport={() => exportCsv(filteredLeads, "nordcall-virksomheder.csv")} />}
          {page === "dialer" && <DialerView
            lead={activeLead} queueCount={queue.length} loading={loading} leadListsLoading={leadListsLoading}
            call={activeCall} elapsed={elapsed} callStarted={callStarted} voiceState={voiceState}
            campaigns={campaigns} leadLists={leadLists} selectedCampaignId={selectedCampaignId} selectedLeadListId={selectedLeadListId}
            onCampaign={(id) => { setSelectedCampaignId(id); setSelectedLeadListId(""); setQueue([]); setActiveLead(null); }}
            onLeadList={(id) => { setSelectedLeadListId(id); setQueue([]); setActiveLead(null); }}
            manualPhone={manualPhone} setManualPhone={setManualPhone} onManualCall={beginManualCall} callStartBusy={callStartBusy}
            onCreateLead={createDialerLead}
            note={callNote} setNote={setCallNote} callbackAt={callbackAt} setCallbackAt={setCallbackAt}
            busy={outcomeBusy} onCall={beginCall} onOutcome={finishCall} onNext={advanceLead}
            onHistoryError={setError}
            onRefresh={() => { setActiveLead(null); void loadPageData("dialer"); }}
            onBookMeeting={() => {
              if (activeLead) setMeetingLeadId(activeLead.id);
              void openPlanner("meeting");
            }}
          />}
          {page === "dialpad" && <DialpadView
            phone={manualPhone} setPhone={setManualPhone} call={activeCall?.lead_id === null ? activeCall : null}
            elapsed={elapsed} callStarted={callStarted} note={callNote} setNote={setCallNote}
            busy={outcomeBusy} onCall={beginManualCall} onOutcome={finishCall}
          />}
          {page === "callbacks" && <CallbacksView callbacks={callbacks} loading={loading} onComplete={completeCallback} onSchedule={() => void openPlanner("callback")} />}
          {page === "meetings" && <MeetingsView meetings={meetings} loading={loading} onBook={() => void openPlanner("meeting")} />}
          {page === "history" && <HistoryView calls={calls} loading={loading} onExport={() => exportCsv(calls.map((call) => ({
            ...call, company_name: call.leads?.company_name ?? "", contact_person: call.leads?.contact_person ?? "",
          })), "nordcall-opkald.csv")} />}
          {page === "import" && profile.role === "admin" && <ImportView
            headers={csvHeaders} rows={csvRows} mapping={csvMapping} errors={csvErrors} progress={csvProgress} busy={csvBusy}
            campaigns={campaigns} leadLists={leadLists} selectedCampaignId={selectedCampaignId} selectedLeadListId={selectedLeadListId}
            newCampaignName={newCampaignName} newLeadListName={newLeadListName} campaignBusy={campaignBusy}
            onCampaign={setSelectedCampaignId} onLeadList={setSelectedLeadListId}
            onNewCampaignName={setNewCampaignName} onNewLeadListName={setNewLeadListName}
            onCreateCampaign={() => void createCampaign()} onCreateLeadList={() => void createLeadList()}
            fileRef={fileRef} onFile={readCsv} onMapping={(key, value) => setCsvMapping((current) => ({ ...current, [key]: value }))}
            onImport={importCsv} onDrop={(file) => readCsv(file)}
          />}
          {page === "team" && <TeamView
            members={team} loading={loading} role={profile.role} campaigns={teamCampaigns} leadLists={teamLeadLists}
            budgets={budgetReport} onSaveBudget={saveBudget}
            onInvite={() => setModal("invite")}
            onSave={async (memberId, fullName, role, campaignIds, leadListIds, callRecordingEnabled, accessMode, canDialManual) => {
              try {
                await api("/api/team", { method: "PATCH", body: JSON.stringify({
                  user_id: memberId, full_name: fullName, role, campaign_ids: campaignIds, lead_list_ids: leadListIds,
                  call_recording_enabled: callRecordingEnabled, access_mode: accessMode, can_dial_manual: canDialManual,
                }) });
                setNotice("Brugerprofil og tildelinger er gemt.");
                void loadPageData("team");
              } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : "Brugerens ændringer kunne ikke gemmes.");
              }
            }}
          />}
          {page === "messages" && <MessagesView
            messages={teamMessages} loading={loading} userId={user.id} role={profile.role}
            campaigns={campaigns} leadLists={teamLeadLists}
            onSend={sendTeamMessage} onMarkRead={markMessageRead}
          />}
          {page === "feedback" && profile.role === "admin" && <AdminFeedbackView
            meetings={adminFeedback} campaigns={campaigns} loading={loading} onOpenPartners={() => setPage("partners")} />}
          {page === "partners" && profile.role === "admin" && <PartnersView
            partners={partnerData.data} campaigns={partnerData.campaigns} loading={loading}
            onCreatePartner={(input) => partnerAction("/api/admin/partners", "POST", input, "Samarbejdspartneren er oprettet.")}
            onUpdatePartner={(input) => partnerAction("/api/admin/partners", "PATCH", input, "Ændringerne er gemt.")}
            onDeletePartner={(id) => partnerAction(`/api/admin/partners?id=${encodeURIComponent(id)}`, "DELETE", null, "Samarbejdspartneren er slettet.")}
            onCreateLogin={(input) => partnerAction("/api/admin/partners/users", "POST", input, "Login er oprettet. Partneren logger ind på /kunde.")}
            onDeleteLogin={(userId) => partnerAction(`/api/admin/partners/users?user_id=${encodeURIComponent(userId)}`, "DELETE", null, "Login er slettet.")}
          />}
          {page === "earnings" && profile.role === "admin" && <EarningsApprovals />}
          {page === "numbers" && profile.role === "admin" && <PhoneNumbersView />}
          {page === "game" && <MagnoraEmpire />}
          {page === "settings" && <SettingsView user={user} profile={profile} onChangePassword={async (password) => {
            if (!supabase) throw new Error("Login er ikke konfigureret.");
            const { error: passwordError } = await supabase.auth.updateUser({ password });
            if (passwordError) throw new Error("Adgangskoden kunne ikke ændres. Log ud og ind igen, og prøv igen.");
          }} />}
        </div>
      </main>
      {modal && <Modal title={modal === "lead" ? "Tilføj virksomhed" : modal === "callback" ? "Planlæg callback" : "Book et møde"} onClose={() => setModal(null)}>
        {modal === "lead" && <form className="modal-form" onSubmit={createLead}>
          <div className="form-grid">
            <label>Kampagne *<select required value={leadFormCampaignId} onChange={(event) => { setLeadFormCampaignId(event.target.value); setLeadFormLeadListId(""); }}>
              <option value="">Vælg kampagne …</option>{leadFormCampaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}
            </select></label>
            <label>Leadliste (valgfri)<select value={leadFormLeadListId} onChange={(event) => setLeadFormLeadListId(event.target.value)} disabled={!leadFormCampaignId}>
              <option value="">Ingen specifik liste</option>{leadFormLists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
            </select></label>
            {profile.role === "admin" && leadFormCampaignId && <div className="field-wide lead-form-list-create">
              <label>Opret ny leadliste under kampagnen<input maxLength={120} value={leadFormNewListName} onChange={(event) => setLeadFormNewListName(event.target.value)} placeholder="Leadlistens navn" /></label>
              <button type="button" className="button button-secondary button-small" disabled={leadFormListBusy || leadFormNewListName.trim().length < 2} onClick={() => void createLeadFormList()}>
                {leadFormListBusy ? "Opretter …" : "Opret leadliste"}
              </button>
            </div>}
            <label className="field-wide">Virksomhedens navn *<input required value={leadForm.company_name} onChange={(event) => setLeadForm({ ...leadForm, company_name: event.target.value })} placeholder="Nordic Studio ApS" /></label>
            <label>Telefonnummer *<input required value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} placeholder="+45 12 34 56 78" /></label>
            <label>CVR-nummer<input value={leadForm.cvr} onChange={(event) => setLeadForm({ ...leadForm, cvr: event.target.value })} placeholder="12345678" /></label>
            <label>Kontaktperson<input value={leadForm.contact_person} onChange={(event) => setLeadForm({ ...leadForm, contact_person: event.target.value })} placeholder="Navn på kontakt" /></label>
            <label>E-mail<input type="email" value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} placeholder="kontakt@virksomhed.dk" /></label>
            <label>Hjemmeside<input type="url" value={leadForm.website} onChange={(event) => setLeadForm({ ...leadForm, website: event.target.value })} placeholder="https://virksomhed.dk" /></label>
            <label className="field-wide">Adresse<input value={leadForm.address} onChange={(event) => setLeadForm({ ...leadForm, address: event.target.value })} placeholder="Vejnavn og nummer" /></label>
            <label>By<input value={leadForm.city} onChange={(event) => setLeadForm({ ...leadForm, city: event.target.value })} placeholder="København" /></label>
            <label>Branche<input value={leadForm.industry} onChange={(event) => setLeadForm({ ...leadForm, industry: event.target.value })} placeholder="F.eks. Software" /></label>
            <label>Medarbejdere<input type="number" min="0" step="1" value={leadForm.employee_count} onChange={(event) => setLeadForm({ ...leadForm, employee_count: event.target.value })} placeholder="25" /></label>
            <label className="field-wide">Noter<textarea rows={3} value={leadForm.notes} onChange={(event) => setLeadForm({ ...leadForm, notes: event.target.value })} placeholder="Det vigtigste at vide om virksomheden …" /></label>
          </div>
          <ModalActions onCancel={() => setModal(null)} submit="Gem virksomhed" />
        </form>}
        {modal === "callback" && <form className="modal-form" onSubmit={addCallback}>
          <label>Virksomhed<select required value={selectedCallbackLead} onChange={(event) => setSelectedCallbackLead(event.target.value)}><option value="">Vælg virksomhed …</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.company_name} · {lead.phone}</option>)}</select></label>
          <label>Dato og tidspunkt<input name="callback_at" required type="datetime-local" min={new Date().toISOString().slice(0, 16)} /></label>
          <label>Noter<textarea name="notes" rows={3} placeholder="Hvad skal I følge op på?" /></label>
          <ModalActions onCancel={() => setModal(null)} submit="Planlæg callback" />
        </form>}
        {modal === "meeting" && <form className="modal-form" onSubmit={addMeeting}>
          <label>Virksomhed<select required value={meetingLeadId} onChange={(event) => setMeetingLeadId(event.target.value)}><option value="">Vælg virksomhed …</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.company_name}</option>)}</select></label>
          <label>Dato og tidspunkt<input required type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></label>
          <label>Mødetype<select name="meeting_type"><option value="online">Online</option><option value="in_person">Personligt møde</option><option value="phone">Telefon</option></select></label>
          {profile?.role === "admin" && <label>Kalenderlink<input name="calendar_url" type="url" placeholder="https://…" /></label>}
          <label>Forberedelse / noter<textarea rows={3} value={meetingNote} onChange={(event) => setMeetingNote(event.target.value)} /></label>
          <ModalActions onCancel={() => setModal(null)} submit="Book møde" />
        </form>}
        {modal === "invite" && <form className="modal-form" onSubmit={inviteMember}>
          <p className="modal-description">Din kollega modtager en sikker invitation på e-mail og tilføjes til dit team som sælger.</p>
          <label>Navn<input name="full_name" required maxLength={120} placeholder="F.eks. Mikkel Sørensen" /></label>
          <label>Arbejdsmail<input name="email" type="email" required placeholder="mikkel@virksomhed.dk" /></label>
          {inviteError && <p className="form-error">{inviteError}</p>}
          <ModalActions onCancel={() => setModal(null)} submit="Send invitation" />
        </form>}
      </Modal>}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand-compact" : ""}`}><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">nordcall<span>.</span></span></div>;
}

function DashboardView({ data, loading, name, role, userId, budgets, setPage, onNewLead, onSaveBudget }: {
  data: DashboardData | null; loading: boolean; name: string; role: Profile["role"]; userId: string;
  budgets: BudgetReport | null; setPage: (page: Page) => void; onNewLead: () => void;
  onSaveBudget: (userId: string, campaignId: string | null, weekly: number, monthly: number) => void;
}) {
  const metrics = [
    { label: "Opkald i dag", value: data?.calls ?? 0, icon: PhoneCall, tone: "blue", meta: `${data?.connected ?? 0} forbundne` },
    { label: "Samtaler", value: data?.conversations ?? 0, icon: Activity, tone: "violet", meta: "Reelle dialoger" },
    { label: "Møder booket", value: data?.meetings ?? 0, icon: CalendarDays, tone: "orange", meta: "I dag" },
    { label: "Konverteringsrate", value: `${data?.conversion_rate ?? 0}%`, icon: Target, tone: "green", meta: "Opkald → møde" },
  ];
  return <div className="view">
    <div className="welcome-row">
      <div>      <div className="eyebrow"><span className="live-dot" /> {new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Copenhagen" }).format(new Date()).toLocaleUpperCase("da-DK")}</div><h1>God eftermiddag, {name}<span className="wave">✳</span></h1><p>Et godt opkald kan være starten på noget stort.</p></div>
      <button className="button button-primary" onClick={() => setPage("dialer")}><Phone size={16} /> Start dagens opkald <ArrowRight size={15} /></button>
    </div>
    <section className="metric-grid">
      {metrics.map(({ label, value, icon: Icon, tone, meta }, index) => <div className="metric-card" key={label}>
        <div className="metric-top"><span>{label}</span><span className={`metric-icon icon-${tone}`}><Icon size={17} /></span></div>
        <div className="metric-value">{loading ? <span className="skeleton skeleton-value" /> : value}</div>
        <div className="metric-meta"><span className={index === 0 ? "meta-positive" : ""}>{index === 0 ? <ArrowUpRight size={13} /> : <span className="meta-dot" />}{meta}</span></div>
      </div>)}
    </section>
    {budgets && <PersonalBudgetCard report={budgets} userId={userId} onSave={onSaveBudget} />}
    <section className="dashboard-columns">
      <div className="panel activity-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">DIT TEMPO</span><h2>Opkaldsaktivitet</h2></div><button className="select-button">Denne uge <ChevronDown size={14} /></button></div>
        <div className="chart-summary"><strong>{data?.activity.reduce((sum, day) => sum + day.calls, 0) ?? 0}</strong><span> opkald de seneste 7 dage <span className="chart-change"><ArrowUpRight size={13} /> Dit team</span></span></div>
        <div className="chart">
          <div className="chart-y"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
          <div className="chart-plot"><div className="chart-lines"><i /><i /><i /><i /><i /></div>
            <div className="chart-bars">{(data?.activity ?? []).map((day) => <div className="bar-group" key={day.key}>
              <div className="bar-pair"><span className="bar bar-primary" style={{ height: `${Math.max(3, Math.min(100, (day.calls / Math.max(1, ...((data?.activity ?? []).map((item) => item.calls)))) * 100))}%` }} /><span className="bar bar-soft" style={{ height: `${Math.max(2, Math.min(100, (day.connected / Math.max(1, ...((data?.activity ?? []).map((item) => item.calls)))) * 100))}%` }} /></div><span className="bar-label">{day.label}</span>
            </div>)}</div>
          </div>
        </div>
        <div className="chart-legend"><span><i className="legend-dot dot-blue" /> Udgående opkald</span><span><i className="legend-dot dot-lavender" /> Gode samtaler</span></div>
      </div>
      <div className="panel daily-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">DAGENS MÅL</span><h2>Din indsats</h2></div><button className="more-button" aria-label="Flere muligheder"><MoreHorizontal size={18} /></button></div>
        <div className="goal-ring-wrap"><div className="goal-ring"><div className="goal-ring-center"><strong>{Math.min(100, Math.round(((data?.calls ?? 0) / 40) * 100))}%</strong><span>af dagens mål</span></div></div></div>
        <div className="goal-list">
          <div><span className="goal-line-icon goal-calls"><PhoneCall size={14} /></span><span>Opkald</span><strong>{data?.calls ?? 0}<small> / 40</small></strong></div>
          <div><span className="goal-line-icon goal-talk"><Timer size={14} /></span><span>Taletid</span><strong>{Math.floor((data?.talk_time ?? 0) / 60)}<small> min</small></strong></div>
          <div><span className="goal-line-icon goal-callback"><CalendarClock size={14} /></span><span>Callbacks</span><strong>{data?.callbacks ?? 0}<small> venter</small></strong></div>
        </div>
      </div>
    </section>
    <section className="bottom-dashboard">
      <div className="panel team-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">SAMMEN ER VI BEDRE</span><h2>Teamets performance</h2></div><button className="text-button" onClick={() => setPage("team")}>Se teamet <ArrowRight size={14} /></button></div>
        {data?.performance.length ? <div className="team-performance">{data.performance.slice(0, 4).map((member, i) => <div className="performance-row" key={member.user_id}>
          <div className={`avatar avatar-${i % 4}`}>{initials(member.name)}</div><strong>{member.name}</strong>
          <div className="performance-bar"><i style={{ width: `${Math.min(100, member.calls * 2.5)}%` }} /></div>
          <span>{member.calls} opkald</span><span className="performance-meet"><CalendarDays size={13} /> {member.meetings}</span>
        </div>)}</div> : <EmptyInline title="Her vises teamets aktivitet" description="Invitér dit salgsteam for at følge resultater sammen." />}
      </div>
      <div className="panel quick-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">KOM HURTIGT I GANG</span><h2>Genveje</h2></div><Sparkles size={16} className="sparkle" /></div>
        <button className="quick-link" onClick={onNewLead}><span className="quick-icon quick-blue"><Plus size={16} /></span><span><strong>Tilføj virksomhed</strong><small>Opret et nyt lead</small></span><ArrowRight size={15} /></button>
        {role === "admin" && <button className="quick-link" onClick={() => setPage("import")}><span className="quick-icon quick-green"><FileSpreadsheet size={16} /></span><span><strong>Importer leads</strong><small>Tilføj fra CSV-fil</small></span><ArrowRight size={15} /></button>}
      </div>
    </section>
  </div>;
}

function AdminCampaignOverview({ overview, onManageTeam }: {
  overview: AdminOverview; onManageTeam: () => void;
}) {
  const metricCards = [
    { title: "Opkald", value: overview.totals.calls.toLocaleString("da-DK"), icon: PhoneCall, tone: "blue" },
    { title: "Forbundne", value: overview.totals.connected.toLocaleString("da-DK"), icon: Headphones, tone: "green" },
    { title: "Bookede møder", value: overview.totals.meetings.toLocaleString("da-DK"), icon: CalendarDays, tone: "purple" },
    { title: "Aktive brugere", value: overview.totals.users.toLocaleString("da-DK"), icon: Users, tone: "amber" },
  ];
  return <section className="admin-insights">
    <div className="admin-insights-heading">
      <div><span className="eyebrow">ADMINISTRATOR · SENESTE 30 DAGE</span><h2>Hele teamet. Ét klart overblik.</h2><p>Resultater på tværs af teamet og hver enkelt kampagne.</p></div>
      <button className="button button-secondary" onClick={onManageTeam}><Users size={15} /> Administrér brugere</button>
    </div>
    <div className="admin-metric-grid">{metricCards.map(({ title, value, icon: Icon, tone }) =>
      <article className="admin-metric-card" key={title}>
        <span className={`admin-metric-icon admin-tone-${tone}`}><Icon size={17} /></span>
        <span>{title}</span><strong>{value}</strong>
      </article>,
    )}</div>
    <section className="panel admin-campaign-panel">
      <div className="panel-heading"><div><span className="panel-eyebrow">KAMPAGNEPERFORMANCE</span><h2>Resultater fordelt på kampagner</h2></div><span className="admin-date-chip">30 dage</span></div>
      <div className="table-scroll"><table><thead><tr><th>Kampagne</th><th>Opkald</th><th>Forbundne</th><th>Møder</th><th>Taletid</th></tr></thead>
        <tbody>{overview.campaigns.map((campaign) => <tr key={campaign.id}>
          <td><strong>{campaign.name}</strong></td><td>{campaign.calls.toLocaleString("da-DK")}</td>
          <td>{campaign.connected.toLocaleString("da-DK")}</td><td>{campaign.meetings.toLocaleString("da-DK")}</td>
          <td>{formatDuration(campaign.talk_time)}</td>
        </tr>)}
          {!overview.campaigns.length && <tr><td colSpan={5}>Opret en kampagne for at se kampagnestatistik her.</td></tr>}
        </tbody>
      </table></div>
      <div className="admin-insights-footer"><span><Timer size={14} /> Samlet taletid: {formatDuration(overview.totals.talk_time)}</span><span>Opkald uden kampagne indgår kun i totalen.</span></div>
    </section>
  </section>;
}

// Every seller covers the system with the first part of each month's commission; the rest is their own.
function SystemFeeCard({ fee, split, own }: { fee: number; split?: { gross: number; covered: number; own: number }; own: boolean }) {
  const gross = split?.gross ?? 0;
  const covered = split?.covered ?? 0;
  const earned = split?.own ?? 0;
  const percent = fee > 0 ? Math.min(100, Math.round(covered / fee * 100)) : 100;
  const done = covered >= fee;
  return <section className="panel system-fee-card">
    <div className="system-fee-head">
      <div><span className="panel-eyebrow">SYSTEMDÆKNING · DENNE MÅNED</span>
        <h2>{done ? (own ? "Systemet er dækket – resten er din indtjening" : "Systemet er dækket") : `${formatMoney(fee - covered)} mangler før ${own ? "din" : "egen"} indtjening starter`}</h2>
        <p>De første {formatMoney(fee)} af {own ? "din" : "sælgerens"} provision hver måned dækker systemet. Alt derover er {own ? "din egen" : "sælgerens egen"} indtjening.</p></div>
    </div>
    <div className="budget-progress-track"><i style={{ width: `${percent}%` }} /></div>
    <div className="system-fee-figures">
      <span><small>Provision i alt</small><strong>{formatMoney(gross)}</strong></span>
      <span><small>Systemdækning</small><strong>{formatMoney(covered)} / {formatMoney(fee)}</strong></span>
      <span className="system-fee-own"><small>{own ? "Din indtjening" : "Sælgerens indtjening"}</small><strong>{formatMoney(earned)}</strong></span>
    </div>
  </section>;
}

function BudgetView({ report, loading, userId, role, onSave, onRecord }: {
  report: BudgetReport | null; loading: boolean; userId: string; role: Profile["role"];
  onSave: (userId: string, campaignId: string, settings: CampaignBudgetSettings) => void;
  onRecord: (campaignId: string, eventType: "meeting" | "sale") => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(userId);
  const [campaignId, setCampaignId] = useState("");
  const [activityMode, setActivityMode] = useState<CampaignBudgetSettings["activity_mode"]>("meeting");
  const [weeklyMeetings, setWeeklyMeetings] = useState("0");
  const [weeklySales, setWeeklySales] = useState("0");
  const [meetingCommission, setMeetingCommission] = useState("0");
  const [saleCommission, setSaleCommission] = useState("0");
  const campaigns = useMemo(() => report?.campaigns ?? [], [report?.campaigns]);
  const members = report?.members ?? [];
  const target = report?.data.find((item) => item.user_id === selectedUserId && item.campaign_id === campaignId);

  useEffect(() => {
    if (role !== "admin") setSelectedUserId(userId);
  }, [role, userId]);
  useEffect(() => {
    if (!campaigns.some((campaign) => campaign.id === campaignId)) setCampaignId(campaigns[0]?.id ?? "");
  }, [campaignId, campaigns]);
  useEffect(() => {
    setActivityMode(target?.activity_mode ?? "meeting");
    setWeeklyMeetings(String(target?.weekly_meeting_target ?? target?.weekly_target ?? 0));
    setWeeklySales(String(target?.weekly_sale_target ?? 0));
    setMeetingCommission(String(target?.commission_per_meeting ?? 0));
    setSaleCommission(String(target?.commission_per_sale ?? 0));
  }, [target]);

  const displayEvents = activityMode === "both" ? ["meeting", "sale"] as const : [activityMode] as const;
  const expectedMonthly = (Number(weeklyMeetings) * Number(meetingCommission)
    + Number(weeklySales) * Number(saleCommission)) * (52 / 12);
  const visibleActivities = (report?.activities ?? []).filter((activity) =>
    activity.campaign_id === campaignId && (role === "admin" ? activity.user_id === selectedUserId : activity.user_id === userId),
  );
  const userName = members.find((member) => member.id === selectedUserId)?.full_name || "Bruger";

  return <div className="view budget-view">
    <div className="page-heading"><div><span className="eyebrow">DIT FOKUS · DINE RESULTATER</span><h1>Budget</h1><p>Sæt et enkelt ugemål, følg aktiviteterne live, og se hvad det giver i provision.</p></div><Target size={21} className="heading-muted" /></div>
    {!campaigns.length && !loading ? <div className="panel empty-panel"><EmptyInline title="Ingen kampagner endnu" description="Når du er tildelt en kampagne, kan du sætte dit mål og din provisionssats her." /></div> : <>
      <section className="panel budget-setup">
        <div className="budget-setup-heading"><span className="panel-eyebrow">ENKEL OPSÆTNING</span><h2>Vælg kampagne og aftal dit mål</h2><p>Målet er pr. uge. Månedsprognosen beregnes automatisk ud fra 52/12 uger.</p></div>
        <form className="campaign-budget-form" onSubmit={(event) => {
          event.preventDefault();
          if (!campaignId) return;
          onSave(selectedUserId, campaignId, {
            activity_mode: activityMode,
            weekly_meeting_target: activityMode === "sale" ? 0 : Number(weeklyMeetings),
            weekly_sale_target: activityMode === "meeting" ? 0 : Number(weeklySales),
            commission_per_meeting: activityMode === "sale" ? 0 : Number(meetingCommission),
            commission_per_sale: activityMode === "meeting" ? 0 : Number(saleCommission),
          });
        }}>
          {role === "admin" && <label>Bruger<select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            {members.map((member) => <option key={member.id} value={member.id}>{member.full_name || "Uden navn"} · {friendlyRole(member.role)}</option>)}
          </select></label>}
          <label>Kampagne<select required value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            <option value="">Vælg kampagne …</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select></label>
          <label>Følg aktivitet<select value={activityMode} onChange={(event) => setActivityMode(event.target.value as CampaignBudgetSettings["activity_mode"])}>
            <option value="meeting">Møder</option><option value="sale">Salg</option><option value="both">Møder og salg</option>
          </select></label>
          {activityMode !== "sale" && <label>Provision pr. møde (kr.)<input required type="number" min="0" max="1000000" step="0.01" value={meetingCommission} onChange={(event) => setMeetingCommission(event.target.value)} /></label>}
          {activityMode !== "meeting" && <label>Provision pr. salg (kr.)<input required type="number" min="0" max="1000000" step="0.01" value={saleCommission} onChange={(event) => setSaleCommission(event.target.value)} /></label>}
          {activityMode !== "sale" && <label>Møder pr. uge<input required type="number" min="0" max="10000" step="1" value={weeklyMeetings} onChange={(event) => setWeeklyMeetings(event.target.value)} /></label>}
          {activityMode !== "meeting" && <label>Salg pr. uge<input required type="number" min="0" max="10000" step="1" value={weeklySales} onChange={(event) => setWeeklySales(event.target.value)} /></label>}
          <div className="budget-form-footer"><span>Forventet provision ved målopfyldelse: <strong>{formatMoney(expectedMonthly)} / måned</strong></span>
            <button className="button button-primary button-small" disabled={!campaignId}><Check size={14} /> Gem mit budget</button>
          </div>
        </form>
      </section>
      <SystemFeeCard fee={report?.system_fee?.fee_dkk ?? 500} split={report?.system_fee?.users[selectedUserId]} own={selectedUserId === userId} />
      {target ? <section className="budget-results">
        <div className="budget-results-heading"><div><span className="panel-eyebrow">{userName} · {target.campaign_name || "Kampagne"}</span><h2>Din fremgang</h2></div><span className="live-tag"><i /> Opdateret live</span></div>
        <div className="budget-kpi-grid">
          <article className="panel budget-commission-card"><span>Provision denne måned</span><strong>{formatMoney(target.monthly_commission)}</strong><small>{target.monthly_meetings + target.monthly_sales} registrerede aktiviteter</small></article>
          <article className="panel budget-commission-card budget-commission-forecast"><span>Hvis du holder dit ugemål</span><strong>{formatMoney(target.expected_monthly_commission)}</strong><small>Forventet provision pr. måned</small></article>
          {displayEvents.map((eventType) => {
            const meeting = eventType === "meeting";
            const current = meeting ? target.weekly_meetings : target.weekly_sales;
            const goal = meeting ? target.weekly_meeting_target : target.weekly_sale_target;
            const monthly = meeting ? target.monthly_meetings : target.monthly_sales;
            const monthlyGoal = Math.round(goal * 52 / 12);
            const percent = goal ? Math.min(100, Math.round(current / goal * 100)) : 0;
            return <article className="panel budget-activity-card" key={eventType}>
              <div className="budget-activity-title"><span>{meeting ? <CalendarDays size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{meeting ? "Møder" : "Salg"}</strong><small>{current} / {goal} denne uge</small></div></div>
              <div className="budget-progress-track"><i style={{ width: `${percent}%` }} /></div>
              <div className="budget-activity-foot"><span>{percent}% af ugemålet</span><span>{monthly} / {monthlyGoal} denne måned</span></div>
              <button className="button button-secondary button-small" onClick={() => onRecord(campaignId, eventType)}>+ Registrer {meeting ? "møde" : "salg"}</button>
            </article>;
          })}
        </div>
        <section className="panel budget-activity-list">
          <div className="panel-heading"><div><span className="panel-eyebrow">SENESTE AKTIVITET</span><h2>Det, der tæller med</h2></div></div>
          {visibleActivities.length ? visibleActivities.slice(0, 8).map((activity) => <div className="budget-activity-row" key={activity.id}>
            <span className={`activity-dot activity-${activity.event_type}`} />
            <strong>{activity.event_type === "meeting" ? "Møde" : "Salg"}</strong>
            <time>{formatDate(activity.created_at, { day: "numeric", month: "short", year: "numeric" })} · {formatTime(activity.created_at)}</time>
          </div>) : <p className="budget-no-activity">Dine møder og salg bliver vist her, når de registreres.</p>}
          <small className="budget-duplicate-note">Møder booket under Møder registreres også automatisk. Registrér ikke det samme møde to gange.</small>
        </section>
      </section> : <div className="panel budget-unconfigured"><Target size={18} /><p>Vælg aktivitetstype, ugemål og provisionssats, og gem opsætningen for at begynde.</p></div>}
    </>}
  </div>;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("da-DK", {
    style: "currency", currency: "DKK", maximumFractionDigits: 0,
  }).format(amount);
}

function PersonalBudgetCard({ report, userId, onSave }: {
  report: BudgetReport; userId: string; onSave: (userId: string, campaignId: string | null, weekly: number, monthly: number) => void;
}) {
  const [campaignId, setCampaignId] = useState("");
  const target = report.data.find((item) => item.user_id === userId && item.campaign_id === (campaignId || null));
  const [weekly, setWeekly] = useState("0");
  const [monthly, setMonthly] = useState("0");
  useEffect(() => {
    setWeekly(String(target?.weekly_target ?? 0));
    setMonthly(String(target?.monthly_target ?? 0));
  }, [target?.id, target?.weekly_target, target?.monthly_target]);
  const weeklyProgress = target?.weekly_target ? Math.min(100, Math.round(target.weekly_meetings / target.weekly_target * 100)) : 0;
  const monthlyProgress = target?.monthly_target ? Math.min(100, Math.round(target.monthly_meetings / target.monthly_target * 100)) : 0;
  return <section className="panel personal-budget">
    <div className="budget-heading"><div><span className="panel-eyebrow">DIT FOKUS · BOOKEDE MØDER</span><h2>Dit budget</h2><p>Følg dine egne aftaler uge for uge og måned for måned.</p></div><Target size={19} /></div>
    <div className="personal-budget-grid">
      <div className="budget-progress-card"><div><strong>Ugens mål</strong><span>{target?.weekly_meetings ?? 0} / {target?.weekly_target ?? 0} møder</span></div>
        <div className="budget-progress-track"><i style={{ width: `${weeklyProgress}%` }} /></div><small>{target?.weekly_target ? `${weeklyProgress}% gennemført` : "Aftal et ugemål med din leder"}</small>
      </div>
      <div className="budget-progress-card"><div><strong>Månedens mål</strong><span>{target?.monthly_meetings ?? 0} / {target?.monthly_target ?? 0} møder</span></div>
        <div className="budget-progress-track budget-progress-month"><i style={{ width: `${monthlyProgress}%` }} /></div><small>{target?.monthly_target ? `${monthlyProgress}% gennemført` : "Sæt et mål sammen med din leder"}</small>
      </div>
    </div>
    <form className="budget-editor" onSubmit={(event) => {
      event.preventDefault();
      onSave(userId, campaignId || null, Number(weekly), Number(monthly));
    }}>
      <label>Budget for<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
        <option value="">Alle kampagner samlet</option>{report.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
      <label>Ugentligt mål<input required type="number" min="0" max="10000" step="1" value={weekly} onChange={(event) => setWeekly(event.target.value)} /></label>
      <label>Månedligt mål<input required type="number" min="0" max="50000" step="1" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></label>
      <button className="button button-secondary button-small"><Check size={14} /> Gem budget</button>
    </form>
  </section>;
}

function LeadsView({ leads, total, page, onPage, loading, status, setStatus, filters, setFilters, members, profile, onAdd, onUpdate, onDelete, onExport }: {
  leads: Lead[]; total: number; page: number; onPage: (page: number) => void; loading: boolean;
  status: string; setStatus: (status: string) => void; profile: Profile;
  filters: LeadFilters; setFilters: (filters: LeadFilters) => void; members: TeamMember[];
  onAdd: () => void; onUpdate: (id: string, update: Record<string, unknown>) => void;
  onDelete: (id: string, companyName: string) => void; onExport: () => void;
}) {
  const activeFilterCount = Object.values(filters).filter(Boolean).length + Number(Boolean(status));
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">DIT SALGSPOTENTIALE</span><h1>Virksomheder</h1><p>Hold styr på dine relationer og næste gode samtale.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={onExport}><ArrowDown size={15} /> Eksportér</button><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Tilføj virksomhed</button></div></div>
    <div className="list-toolbar"><div className="filter-tabs">
      <button className={!status ? "filter-active" : ""} onClick={() => setStatus("")}>Alle</button>
      <button className={status === "new" ? "filter-active" : ""} onClick={() => setStatus("new")}>Nye</button>
      <button className={status === "to_call" ? "filter-active" : ""} onClick={() => setStatus("to_call")}>Skal ringes</button>
      <button className={status === "callback" ? "filter-active" : ""} onClick={() => setStatus("callback")}>Callbacks</button>
    </div><details className="lead-filters"><summary className="filter-more"><SlidersHorizontal size={15} /> Filtre <span className="filter-tiny">{activeFilterCount}</span></summary>
      <div className="lead-filter-panel">
        <label>By<input value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} placeholder="Søg by" /></label>
        <label>Branche<input value={filters.industry} onChange={(event) => setFilters({ ...filters, industry: event.target.value })} placeholder="Søg branche" /></label>
        <label>Medarbejdere fra<input type="number" min="0" value={filters.employees_min} onChange={(event) => setFilters({ ...filters, employees_min: event.target.value })} placeholder="Min." /></label>
        <label>Medarbejdere til<input type="number" min="0" value={filters.employees_max} onChange={(event) => setFilters({ ...filters, employees_max: event.target.value })} placeholder="Maks." /></label>
        <label>Sidst kontaktet efter<input type="date" value={filters.last_contacted_after} onChange={(event) => setFilters({ ...filters, last_contacted_after: event.target.value })} /></label>
        <label>Callback fra<input type="date" value={filters.callback_after} onChange={(event) => setFilters({ ...filters, callback_after: event.target.value })} /></label>
        {profile.role === "admin" && <label>Bruger<select value={filters.assigned_user_id} onChange={(event) => setFilters({ ...filters, assigned_user_id: event.target.value })}>
          <option value="">Alle sælgere</option><option value="unassigned">Ikke tildelt</option>
          {members.map((member) => <option value={member.id} key={member.id}>{member.full_name || "Uden navn"}</option>)}
        </select></label>}
        <label>Leadstatus<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Alle statusser</option>{statusChoices.map((item) => <option value={item} key={item}>{statuses[item]}</option>)}</select></label>
        <button type="button" className="text-button" onClick={() => {
          setFilters({ city: "", industry: "", employees_min: "", employees_max: "", assigned_user_id: "", last_contacted_after: "", callback_after: "" });
          setStatus("");
        }}>Nulstil filtre</button>
      </div>
    </details></div>
    <div className="table-card">
      <div className="table-caption"><span>{loading ? "Henter virksomheder …" : `${leads.length} virksomheder`}</span><span className="table-caption-right"><span className="live-dot" /> Synkroniseret</span></div>
      <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Vælg alle" /></th><th>VIRKSOMHED</th><th>KONTAKTPERSON</th><th>STATUS</th><th>BY</th><th>NÆSTE AKTIVITET</th><th></th></tr></thead>
        <tbody>{leads.map((lead, index) => <tr key={lead.id}>
          <td><input type="checkbox" aria-label={`Vælg ${lead.company_name}`} /></td>
          <td><div className="company-cell"><span className={`company-avatar company-${index % 6}`}>{initials(lead.company_name)}</span><span><strong>{lead.company_name}</strong><small>{lead.cvr ? `CVR ${lead.cvr}` : lead.industry || lead.phone}</small></span></div></td>
          <td><span className="person-name">{lead.contact_person || "—"}</span><small className="table-sub">{lead.phone}</small></td>
          <td><select className={`status-pill status-${lead.status}`} value={lead.status} aria-label="Leadstatus" onChange={(event) => onUpdate(lead.id, { status: event.target.value })}>{statusChoices.map((item) => <option value={item} key={item}>{statuses[item]}</option>)}</select></td>
          <td>{lead.city || "—"}</td>
          <td>{lead.next_follow_up_at ? <span className="next-activity"><CalendarClock size={14} /> {formatDate(lead.next_follow_up_at)} · {formatTime(lead.next_follow_up_at)}</span> : <span className="muted-cell">Ingen planlagt</span>}</td>
          <td>{profile.role === "admin"
            ? <button className="row-more" aria-label={`Slet ${lead.company_name}`} title="Slet virksomhed" onClick={() => onDelete(lead.id, lead.company_name)}><Trash2 size={15} /></button>
            : <button className="row-more" aria-label={`Markér ${lead.company_name} som skal ringes`} title="Markér som skal ringes" onClick={() => onUpdate(lead.id, { status: "to_call" })}><MoreHorizontal size={17} /></button>}</td>
        </tr>)}
        {!loading && !leads.length && <tr><td colSpan={7}><EmptyInline title="Din pipeline starter her" description="Tilføj din første virksomhed eller importer en CSV-liste." /></td></tr>}
        </tbody></table></div>
      <div className="table-footer"><span>Viser <strong>{total ? page * 100 + 1 : 0}–{Math.min((page + 1) * 100, total)}</strong> af {total} virksomheder</span><div><button disabled={page === 0 || loading} onClick={() => onPage(page - 1)} aria-label="Forrige side"><ChevronLeft size={15} /></button><span className="page-number">{page + 1}</span><button disabled={(page + 1) * 100 >= total || loading} onClick={() => onPage(page + 1)} aria-label="Næste side"><ChevronRight size={15} /></button></div></div>
    </div>
    <div className="tip-banner"><span><Sparkles size={16} /></span><p><strong>Et godt tip:</strong> Hold dine opfølgningsdatoer opdaterede — de rigtige leads fortjener et rettidigt opkald.</p><button onClick={() => window.location.assign("#")} aria-label="Luk"><X size={15} /></button></div>
    {profile.role === "admin" && <p className="privacy-foot"><CheckCircle2 size={14} /> Sletning af persondata håndteres sikkert af en administrator.</p>}
  </div>;
}

function DialerView({ lead, queueCount, loading, leadListsLoading, call, elapsed, callStarted, voiceState, campaigns, leadLists, selectedCampaignId, selectedLeadListId,
  onCampaign, onLeadList, manualPhone, setManualPhone, onManualCall, callStartBusy, onCreateLead,
  note, setNote, callbackAt, setCallbackAt, busy, onCall, onOutcome, onNext, onRefresh, onBookMeeting, onHistoryError }: {
  lead: Lead | null; queueCount: number; loading: boolean; leadListsLoading: boolean; call: Call | null; elapsed: number; callStarted: number | null; voiceState: "disconnected" | "connecting" | "ready"; note: string; setNote: (value: string) => void;
  campaigns: Campaign[]; leadLists: LeadList[]; selectedCampaignId: string; selectedLeadListId: string;
  onCampaign: (id: string) => void; onLeadList: (id: string) => void;
  manualPhone: string; setManualPhone: (phone: string) => void; onManualCall: () => void; callStartBusy: boolean;
  onCreateLead: (input: { company_name: string; phone: string; contact_person: string; notes: string }) => Promise<boolean>;
  callbackAt: string; setCallbackAt: (value: string) => void; busy: boolean; onCall: () => void; onOutcome: (outcome: string) => void;
  onNext: () => void; onRefresh: () => void; onBookMeeting: () => void; onHistoryError: (message: string) => void;
}) {
  const [history, setHistory] = useState<LeadHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newLead, setNewLead] = useState({ company_name: "", phone: "", contact_person: "", notes: "" });
  const [newLeadBusy, setNewLeadBusy] = useState(false);
  useEffect(() => {
    if (!lead?.id) {
      setHistory([]);
      return;
    }
    let alive = true;
    setHistoryLoading(true);
    void api<{ data: LeadHistoryEntry[] }>(`/api/leads/${lead.id}/history`).then(({ data }) => {
      if (alive) setHistory(data);
    }).catch((loadError) => {
      if (alive) onHistoryError(loadError instanceof Error ? loadError.message : "Leadets historik kunne ikke indlæses.");
    }).finally(() => {
      if (alive) setHistoryLoading(false);
    });
    return () => { alive = false; };
  }, [lead?.id, call?.id, onHistoryError]);
  const awaitingOutcome = Boolean(call && ["completed", "busy", "failed", "no_answer", "cancelled"].includes(call.status) && !call.outcome);
  const active = Boolean(call && (["queued", "initiated", "ringing", "answered"].includes(call.status) || awaitingOutcome));
  async function submitNewLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewLeadBusy(true);
    try {
      if (await onCreateLead(newLead)) setNewLead({ company_name: "", phone: "", contact_person: "", notes: "" });
    } finally {
      setNewLeadBusy(false);
    }
  }
  const leadFields: [string, string][] = lead ? ([
    ["Kontaktperson", lead.contact_person || ""],
    ["CVR-nummer", lead.cvr || ""],
    ["Telefonnummer", lead.phone],
    ["E-mail", lead.email || ""],
    ["Hjemmeside", lead.website || ""],
    ["Adresse", lead.address || ""],
    ["By", lead.city || ""],
    ["Branche", lead.industry || ""],
    ["Medarbejdere", lead.employee_count === null || lead.employee_count === undefined ? "" : lead.employee_count.toLocaleString("da-DK")],
  ] satisfies [string, string][]).filter(([, value]) => Boolean(value)) : [];
  return <div className="view dialer-view">
    <div className="dialer-title"><div><span className="eyebrow">DIN NÆSTE GODE SAMTALE</span><h1>Opkald</h1><p>Fokus på relationen. Nordcall klarer resten.</p></div>
      <div className="queue-chip"><span className="queue-pulse" /> {queueCount} leads i kø <button aria-label="Hent opkaldskø" onClick={onRefresh}><ArrowDown size={14} /></button></div>
    </div>
    <div className="campaign-selectors panel">
      <label>Kampagne<select value={selectedCampaignId} onChange={(event) => onCampaign(event.target.value)}>
        <option value="">Vælg kampagne …</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
      <label>Leadliste<select value={selectedLeadListId} onChange={(event) => onLeadList(event.target.value)} disabled={!selectedCampaignId || leadListsLoading}>
        <option value="">{leadListsLoading ? "Indlæser leadlister …" : "Alle leads i kampagnen"}</option>{leadLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select></label>
      <span>{leadListsLoading ? "Henter dine tildelte leadlister …" : "Vælg en kampagne og eventuelt en bestemt leadliste."}</span>
    </div>
    <div className="panel dialer-manual-call">
      <div><span className="panel-eyebrow">MANUELT OPKALD</span><strong>Ring til et nummer uden for leadlisten</strong></div>
      <label>Telefonnummer<input inputMode="tel" value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} placeholder="+45 12 34 56 78" /></label>
      <button className="button button-primary button-small" disabled={!manualPhone.trim() || callStartBusy || active} onClick={onManualCall}>
        <PhoneCall size={14} /> {callStartBusy ? "Starter …" : "Ring manuelt"}
      </button>
    </div>
    <div className="dialer-grid">
      <div className="panel current-lead-panel">
        {lead ? <>
          <div className="lead-card-top"><span className="section-tag"><i /> NÆSTE I KØEN</span><span className="lead-position">Din opkaldsliste <strong>{queueCount > 0 ? `01 / ${String(queueCount).padStart(2, "0")}` : "—"}</strong></span></div>
          <div className="dialer-company-head"><div className="dialer-company-logo">{initials(lead.company_name)}</div><div><h2>{lead.company_name}</h2><span>{lead.industry || "Dansk virksomhed"}{lead.city ? ` · ${lead.city}` : ""}</span></div><button className="more-button"><MoreHorizontal size={18} /></button></div>
          <div className="lead-detail-grid">
            {leadFields.map(([label, value]) => <div key={label}><span>{label.toLocaleUpperCase("da-DK")}</span><strong>
              {label === "E-mail" ? <a href={`mailto:${value}`}>{value}</a>
                : label === "Telefonnummer" ? <a className="phone-detail" href={`tel:${value}`}><Phone size={14} /> {value}</a>
                  : label === "Hjemmeside" && /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a>
                    : value}
            </strong></div>)}
          </div>
          <div className="call-controls">
            {active ? <>
              <div className={`call-state state-${call?.status}`}><span className="call-state-dot" />{awaitingOutcome ? "Opkald afsluttet — vælg resultat" : call?.status === "ringing" ? "Ringer …" : call?.status === "answered" ? "Forbundet" : "Opkald starter"}{!awaitingOutcome && <span className="timer-display">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}</div>
              {callStarted && !awaitingOutcome && <div className="call-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>}
              <div className="outcome-section">
                <span className="outcome-label">AFSLUT SAMTALE MED ET RESULTAT</span>
                <div className="outcome-grid">{[
                  ["interested", "Interesseret", "outcome-good"], ["meeting_booked", "Møde booket", "outcome-meeting"],
                  ["callback", "Ring tilbage", "outcome-callback"], ["no_answer", "Intet svar", "outcome-muted"],
                  ["not_interested", "Ikke interesseret", "outcome-muted"], ["wrong_number", "Forkert nummer", "outcome-muted"],
                ].map(([value, label, tone]) => <button disabled={busy} key={value} className={`outcome-button ${tone}`} onClick={() => onOutcome(value)}>{label}</button>)}</div>
                <div className="callback-inline"><label>Planlæg callback<input aria-label="Callback dato og tid" type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label><button disabled={busy || !callbackAt} onClick={() => onOutcome("callback")}>Gem callback</button></div>
              </div>
            </> : <div className="call-action-row">
              <button className="call-button" disabled={callStartBusy || active} onClick={onCall}><span><PhoneCall size={20} /></span><strong>{callStartBusy ? "Forbinder headset …" : "Ring op"}</strong><small>{voiceState === "ready" ? "Headset forbundet" : "Sikker headsetforbindelse"}</small></button>
              <button className="next-button" onClick={onNext}>Spring over <ArrowRight size={15} /></button>
            </div>}
          </div>
          <div className="dialer-notes"><div className="notes-heading"><span><MoreHorizontal size={16} /> Samtalenoter</span><small>Synkroniseres, når du vælger resultat</small></div><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Skriv et par ord, du vil huske til næste gang …" /></div>
          <div className="dialer-bottom"><button className="subtle-action" onClick={onBookMeeting}><CalendarDays size={15} /> Planlæg møde</button><span className="secure-call"><CheckCircle2 size={14} /> Sikker forbindelse</span></div>
        </> : call && !call.lead_id ? <div className="manual-call-active">
          <span className="empty-queue-icon"><PhoneCall size={22} /></span><h2>Manuelt opkald</h2><strong>{call.phone}</strong>
          <div className={`call-state state-${call.status}`}><span className="call-state-dot" />{awaitingOutcome ? "Opkald afsluttet — vælg resultat" : call.status === "ringing" ? "Ringer …" : call.status === "answered" ? "Forbundet" : "Opkald starter"}{!awaitingOutcome && <span className="timer-display">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}</div>
          <div className="outcome-grid">{[
            ["interested", "Interesseret", "outcome-good"], ["meeting_booked", "Møde booket", "outcome-meeting"],
            ["no_answer", "Intet svar", "outcome-muted"], ["not_interested", "Ikke interesseret", "outcome-muted"],
          ].map(([value, label, tone]) => <button disabled={busy} key={value} className={`outcome-button ${tone}`} onClick={() => onOutcome(value)}>{label}</button>)}</div>
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Noter til det manuelle opkald …" />
        </div> : <div className="empty-queue">
          <span className="empty-queue-icon"><Check size={28} /></span>
          <h2>{!campaigns.length ? "Ingen kampagner tildelt" : !selectedCampaignId ? "Vælg din kampagne" : "Du er up to date"}</h2>
          <p>{!campaigns.length ? "Bed din administrator om at tildele dig en kampagne." : !selectedCampaignId ? "Vælg en kampagne ovenfor. Du kan også ringe manuelt til et nummer uden lead." : "Der er ingen leads klar til opkald i dit udvalg lige nu. Alle fremtidige callbacks holdes uden for køen."}</p>
          {selectedCampaignId && <button className="button button-secondary" onClick={onRefresh}><ArrowDown size={15} /> Opdatér køen</button>}
          {selectedCampaignId && <form className="dialer-create-lead" onSubmit={(event) => void submitNewLead(event)}>
            <span className="panel-eyebrow">{selectedLeadListId ? "TILFØJ ET LEAD TIL DEN VALGTE LISTE" : "TILFØJ ET LEAD TIL KAMPAGNEN"}</span>
            <label>Virksomhed *<input required maxLength={200} value={newLead.company_name} onChange={(event) => setNewLead({ ...newLead, company_name: event.target.value })} placeholder="Virksomhedens navn" /></label>
            <label>Telefonnummer *<input required inputMode="tel" value={newLead.phone} onChange={(event) => setNewLead({ ...newLead, phone: event.target.value })} placeholder="+45 12 34 56 78" /></label>
            <label>Kontaktperson<input maxLength={150} value={newLead.contact_person} onChange={(event) => setNewLead({ ...newLead, contact_person: event.target.value })} placeholder="Navn (valgfrit)" /></label>
            <label>Noter<textarea rows={2} maxLength={5000} value={newLead.notes} onChange={(event) => setNewLead({ ...newLead, notes: event.target.value })} placeholder="Et par nyttige oplysninger (valgfrit)" /></label>
            <button className="button button-primary" disabled={newLeadBusy}><Plus size={15} /> {newLeadBusy ? "Opretter …" : "Opret lead og tilføj til køen"}</button>
          </form>}
        </div>}
      </div>
      <aside className="dialer-side">
        <div className="panel context-panel"><div className="panel-heading"><div><span className="panel-eyebrow">VIRKSOMHEDSINFO</span><h2>Overblik</h2></div><Building2 size={17} className="heading-muted" /></div>
          {lead ? <><div className="context-row"><span>Leadstatus</span><span className={`status-pill status-${lead.status}`}>{statuses[lead.status] || lead.status}</span></div><div className="context-row"><span>Oprettet</span><strong>{formatDate(lead.created_at)}</strong></div><div className="context-row"><span>Næste opfølgning</span><strong>{lead.next_follow_up_at ? `${formatDate(lead.next_follow_up_at)} · ${formatTime(lead.next_follow_up_at)}` : "Ikke planlagt"}</strong></div>
            <div className="context-note"><span>LEADNOTER</span><p>{lead.notes || "Ingen noter endnu. Gode noter gør næste samtale endnu bedre."}</p></div></> : <EmptyInline title="Ingen virksomhed valgt" description="Vælg et lead i opkaldskøen." />}
        </div>
        <div className="panel recent-panel"><div className="panel-heading"><div><span className="panel-eyebrow">KUNDEHISTORIK</span><h2>Noter og tidligere kontakt</h2></div><Clock3 size={16} className="heading-muted" /></div>
            {history.length ? history.map((item) => <article className="lead-history-item" key={`${item.kind}-${item.id}`}>
              <div className="lead-history-heading"><strong>{item.kind === "call" ? `Opkald · ${statuses[item.title] || item.title}` : item.title}</strong><time>{formatDate(item.created_at)} · {formatTime(item.created_at)}</time></div>
              {item.kind === "call" && item.duration_seconds !== null && <small>{formatDuration(item.duration_seconds)}</small>}
              {item.body && <p>{item.body}</p>}
              {item.recording_url && <audio controls preload="none" src={item.recording_url}>Din browser understøtter ikke lydafspilning.</audio>}
            </article>) : historyLoading ? <span className="skeleton" /> : <EmptyInline title="Ingen tidligere kontakt" description="Opkald, noter og møder på denne virksomhed vises her." />}
        </div>
        <div className="compliance-card"><span><CheckCircle2 size={16} /></span><p><strong>Gode opkald starter med respekt.</strong> Husk altid at præsentere dig og respektere et nej.</p></div>
      </aside>
    </div>
  </div>;
}

function DialpadView({ phone, setPhone, call, elapsed, callStarted, note, setNote, busy, onCall, onOutcome }: {
  phone: string; setPhone: (value: string) => void; call: Call | null; elapsed: number; callStarted: number | null;
  note: string; setNote: (value: string) => void; busy: boolean; onCall: () => void; onOutcome: (value: string) => void;
}) {
  const [history, setHistory] = useState<Call[]>([]);
  useEffect(() => {
    void api<{ data: Call[] }>("/api/calls").then(({ data }) => setHistory(data.filter((item) => !item.lead_id).slice(0, 6))).catch(() => undefined);
  }, [call?.id]);
  const awaitingOutcome = Boolean(call && ["completed", "busy", "failed", "no_answer", "cancelled"].includes(call.status) && !call.outcome);
  const active = Boolean(call && (["queued", "initiated", "ringing", "answered"].includes(call.status) || awaitingOutcome));
  return <div className="view dialpad-view">
    <div className="page-heading"><div><span className="eyebrow">RING TIL ET FRIT NUMMER</span><h1>Dialpad</h1><p>Indtast et nummer, og ring direkte fra din browser.</p></div><span className="secure-tag"><CheckCircle2 size={14} /> Direkte opkald</span></div>
    <div className="dialpad-layout">
      <section className="panel dialpad-panel">
        <div className="panel-heading"><div><span className="panel-eyebrow">TELEFONNUMMER</span><h2>Manuelt opkald</h2></div><PhoneCall size={17} className="heading-muted" /></div>
        {active && call ? <>
          <div className={`call-state state-${call.status}`}><span className="call-state-dot" />{awaitingOutcome ? "Opkald afsluttet — vælg resultat" : call.status === "ringing" ? "Ringer …" : call.status === "answered" ? "Forbundet" : "Opkald starter"}{!awaitingOutcome && <span className="timer-display">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}</div>
          {callStarted && !awaitingOutcome && <div className="call-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>}
          <strong className="manual-call-number">{call.phone}</strong>
          <div className="dialpad-outcomes">{[
            ["answered", "Besvaret"], ["no_answer", "Intet svar"], ["busy", "Optaget"], ["failed", "Mislykket"],
          ].map(([value, label]) => <button className="button button-secondary" key={value} disabled={busy} onClick={() => onOutcome(value)}>{label}</button>)}</div>
          <label className="manual-call-notes">Samtalenoter<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Noter om opkaldet …" /></label>
        </> : <>
          <input className="dialpad-number" aria-label="Telefonnummer" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+45 12 34 56 78" />
          <div className="dialpad-keys">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map((digit) =>
            <button key={digit} aria-label={digit === "⌫" ? "Slet sidste ciffer" : `Indtast ${digit}`} onClick={() => setPhone(digit === "⌫" ? phone.slice(0, -1) : digit === "+" && phone.length ? phone : `${phone}${digit}`)}>{digit}</button>,
          )}</div>
          <button className="button button-primary button-wide dialpad-call-button" disabled={!phone.trim() || busy} onClick={onCall}><PhoneCall size={17} /> {busy ? "Forbinder headset …" : "Ring op"}</button>
        </>}
        <p className="dialpad-disclaimer">Opkaldet går til et rigtigt telefonnummer.</p>
      </section>
      <aside className="panel dialpad-history"><div className="panel-heading"><div><span className="panel-eyebrow">SENESTE AKTIVITET</span><h2>Manuelle opkald</h2></div><Clock3 size={16} className="heading-muted" /></div>
        {history.length ? history.map((item) => <div className="recent-call" key={item.id}><span className="recent-call-icon"><Phone size={14} /></span><span><strong>{item.phone}</strong><small>{formatDate(item.started_at)} · {formatTime(item.started_at)}</small></span><span className="recent-duration">{formatDuration(item.duration_seconds)}</span></div>) : <EmptyInline title="Ingen manuelle opkald" description="Opkald fra Dialpad vises her." />}
      </aside>
    </div>
  </div>;
}

function CallbacksView({ callbacks, loading, onComplete, onSchedule }: { callbacks: Callback[]; loading: boolean; onComplete: (id: string) => void; onSchedule: () => void }) {
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">HUSK DET, I AFTALER</span><h1>Callbacks</h1><p>De rigtige opfølgninger på det rigtige tidspunkt.</p></div><button className="button button-primary" onClick={onSchedule}><Plus size={16} /> Planlæg callback</button></div>
    <div className="panel schedule-panel"><div className="schedule-date"><span className="schedule-day">{new Date().toLocaleDateString("da-DK", { day: "2-digit" })}</span><span>{new Date().toLocaleDateString("da-DK", { month: "long", weekday: "long" })}</span></div>
      <div className="schedule-count"><CalendarClock size={15} /> {callbacks.length} planlagt{callbacks.length === 1 ? "" : "e"} opfølgning{callbacks.length === 1 ? "" : "er"}</div></div>
    <div className="callback-list">{callbacks.map((callback) => <div className="panel callback-card" key={callback.id}>
      <div className="callback-time"><strong>{formatTime(callback.callback_at)}</strong><span>{formatDate(callback.callback_at, { weekday: "short", day: "numeric", month: "short" })}</span></div>
      <div className="timeline-line"><i /></div>
      <div className="callback-company"><span className="company-avatar company-2">{initials(callback.leads?.company_name || "V")}</span><span><strong>{callback.leads?.company_name || "Virksomhed"}</strong><small>{callback.leads?.contact_person || callback.leads?.phone || "Kontaktperson"}</small>{callback.notes && <p>{callback.notes}</p>}</span></div>
      <a className="callback-phone" href={`tel:${callback.leads?.phone}`}><Phone size={14} /> {callback.leads?.phone}</a>
      <button className="button button-secondary button-small" onClick={() => onComplete(callback.id)}><Check size={14} /> Gennemført</button>
    </div>)}
      {!callbacks.length && <div className="panel empty-panel">{loading ? <span className="skeleton" /> : <EmptyInline title="Ingen callbacks lige nu" description="Planlæg opfølgninger efter dine samtaler — de dukker automatisk op her." />}</div>}
    </div>
  </div>;
}

function MeetingsView({ meetings, loading, onBook }: { meetings: Meeting[]; loading: boolean; onBook: () => void }) {
  const [stateFilter, setStateFilter] = useState<MeetingState | "all">("all");
  const withCustomer = meetings.filter((meeting) => meeting.has_customer || meeting.feedback);
  const states: MeetingState[] = ["good", "less_good", "not_qualified", "overdue", "awaiting", "upcoming"];
  const visible = stateFilter === "all" ? meetings : meetings.filter((meeting) =>
    (meeting.has_customer || meeting.feedback) && meetingState(meeting) === stateFilter);
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">RELATIONER, DER RYKKER</span><h1>Møder</h1><p>Hold styr på de næste skridt med dine kunder.</p></div><button className="button button-primary" onClick={onBook}><Plus size={16} /> Book et møde</button></div>
    {withCustomer.length > 0 && <div className="fb-filter-row" role="group" aria-label="Filtrér på kundens status">
      <button className={stateFilter === "all" ? "fb-filter-active" : ""} onClick={() => setStateFilter("all")}>Alle · {meetings.length}</button>
      {states.map((state) => <button key={state} className={`fb-filter-${state} ${stateFilter === state ? "fb-filter-active" : ""}`} onClick={() => setStateFilter(state)}>
        {meetingStateLabels[state]} · {withCustomer.filter((meeting) => meetingState(meeting) === state).length}
      </button>)}
    </div>}
    <div className="meeting-grid">{visible.map((meeting, index) => <article className="panel meeting-card" key={meeting.id}>
      <div className={`meeting-date-chip meeting-chip-${index % 3}`}><strong>{new Date(meeting.meeting_at).toLocaleDateString("da-DK", { day: "2-digit" })}</strong><span>{new Date(meeting.meeting_at).toLocaleDateString("da-DK", { month: "short" })}</span></div>
      <div className="meeting-card-body"><span className="eyebrow">{formatTime(meeting.meeting_at)} · {meeting.meeting_type === "online" ? "ONLINE" : meeting.meeting_type === "in_person" ? "PERSONLIGT" : "TELEFON"}</span><h2>{meeting.leads?.company_name || "Virksomhed"}</h2><p>{meeting.leads?.contact_person || meeting.leads?.phone || "Kontaktperson"}</p>{meeting.notes && <div className="meeting-notes">{meeting.notes}</div>}<MeetingFeedbackNote feedback={meeting.feedback} /></div>
      {meeting.has_customer || meeting.feedback ? <FeedbackBadge meeting={meeting} /> : <span className="meeting-state"><span /> Planlagt</span>}
    </article>)}{!visible.length && <div className="panel empty-panel">{loading ? <span className="skeleton" /> : <EmptyInline title={meetings.length ? "Ingen møder med denne status" : "Dine møder lander her"} description={meetings.length ? "Vælg et andet filter for at se flere møder." : "Book et møde med et lead for at holde alle aftaler samlet."} />}</div>}</div>
  </div>;
}

function HistoryView({ calls, loading, onExport }: { calls: Call[]; loading: boolean; onExport: () => void }) {
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ALLE DINE SAMTALER, SAMLET</span><h1>Opkaldshistorik</h1><p>Et godt overblik gør hver næste samtale lidt bedre.</p></div><button className="button button-secondary" onClick={onExport}><ArrowDown size={15} /> Eksportér</button></div>
    <div className="table-card"><div className="table-caption"><span>{calls.length} seneste opkald</span><button className="filter-more"><Filter size={15} /> Filtre</button></div>
      <div className="table-scroll"><table><thead><tr><th>VIRKSOMHED</th><th>TELEFON</th><th>DATO & TID</th><th>VARIGHED</th><th>RESULTAT</th></tr></thead><tbody>
        {calls.map((call) => <tr key={call.id}><td><div className="company-cell"><span className="company-avatar company-1">{initials(call.leads?.company_name || call.phone)}</span><span><strong>{call.leads?.company_name || (call.lead_id ? "Virksomhed slettet" : "Manuelt opkald")}</strong><small>{call.leads?.contact_person || (!call.lead_id ? call.phone : "—")}</small></span></div></td><td>{call.phone}</td><td>{formatDate(call.started_at, { day: "numeric", month: "short", year: "numeric" })}<small className="table-sub">{formatTime(call.started_at)}</small></td><td>{formatDuration(call.duration_seconds)}</td><td><span className={`status-pill status-${call.outcome || call.status}`}>{statuses[call.outcome || call.status] || call.outcome || call.status}</span></td></tr>)}
        {!calls.length && <tr><td colSpan={5}><EmptyInline title={loading ? "Henter opkald …" : "Ingen opkald endnu"} description="Dine opkald vises her, når du har haft din første samtale." /></td></tr>}
      </tbody></table></div></div>
  </div>;
}

function ImportView({ headers, rows, mapping, errors, progress, busy, campaigns, leadLists, selectedCampaignId, selectedLeadListId,
  newCampaignName, newLeadListName, campaignBusy, onCampaign, onLeadList, onNewCampaignName, onNewLeadListName,
  onCreateCampaign, onCreateLeadList, fileRef, onFile, onMapping, onImport, onDrop }: {
  headers: string[]; rows: CsvRow[]; mapping: Partial<Record<CsvField, string>>; errors: { row: number; reason: string }[];
  campaigns: Campaign[]; leadLists: LeadList[]; selectedCampaignId: string; selectedLeadListId: string;
  newCampaignName: string; newLeadListName: string; campaignBusy: boolean;
  onCampaign: (id: string) => void; onLeadList: (id: string) => void;
  onNewCampaignName: (value: string) => void; onNewLeadListName: (value: string) => void;
  onCreateCampaign: () => void; onCreateLeadList: () => void;
  progress: number; busy: boolean; fileRef: React.RefObject<HTMLInputElement | null>; onFile: (file?: File) => void;
  onMapping: (key: CsvField, value: string) => void; onImport: () => void; onDrop: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">DIN PIPELINE, PÅ DINE PRÆMISSER</span><h1>Importer leads</h1><p>Kom godt fra start med dine eksisterende virksomhedslister.</p></div><span className="secure-tag"><CheckCircle2 size={15} /> Sikker import</span></div>
    <div className="import-steps"><div className="step-active"><span>01</span> Upload fil</div><i /><div className={headers.length ? "step-active" : ""}><span>02</span> Match kolonner</div><i /><div className={progress === 100 ? "step-active" : ""}><span>03</span> Importér</div></div>
    <div className="panel import-panel">
      {!headers.length ? <button className={`dropzone ${dragging ? "dropzone-active" : ""}`} onClick={() => fileRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onDrop(file); }}>
        <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => onFile(event.target.files?.[0])} />
        <span className="upload-icon"><FileSpreadsheet size={23} /></span><strong>Slip din CSV-fil her</strong><span>eller <u>vælg en fil fra din computer</u></span><small>CSV · Op til 10.000 virksomheder · UTF-8</small>
      </button> : <div className="import-content">
        <div className="import-file-row"><span className="upload-icon upload-icon-small"><FileSpreadsheet size={18} /></span><span><strong>{rows.length.toLocaleString("da-DK")} rækker fundet</strong><small>{headers.length} kolonner · CSV-fil</small></span><button className="text-button" onClick={() => fileRef.current?.click()}>Vælg en anden fil</button><input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => onFile(event.target.files?.[0])} /></div>
        <div className="campaign-import panel">
          <div><span className="panel-eyebrow">ORGANISÉR DIN LEADLISTE</span><h2>Vælg kampagne og leadliste</h2><p>Alle importerede leads knyttes til den valgte liste.</p></div>
          <label>Kampagne<select value={selectedCampaignId} onChange={(event) => onCampaign(event.target.value)}>
            <option value="">Vælg kampagne …</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select></label>
          <div className="campaign-create-row"><input value={newCampaignName} onChange={(event) => onNewCampaignName(event.target.value)} maxLength={120} placeholder="Ny kampagnes navn" /><button className="button button-secondary button-small" onClick={onCreateCampaign} disabled={campaignBusy || newCampaignName.trim().length < 2}>Opret kampagne</button></div>
          <label>Leadliste<select value={selectedLeadListId} onChange={(event) => onLeadList(event.target.value)} disabled={!selectedCampaignId}>
            <option value="">Vælg leadliste …</option>{leadLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select></label>
          <div className="campaign-create-row"><input value={newLeadListName} onChange={(event) => onNewLeadListName(event.target.value)} maxLength={120} placeholder="Ny leadlistes navn" disabled={!selectedCampaignId} /><button className="button button-secondary button-small" onClick={onCreateLeadList} disabled={campaignBusy || !selectedCampaignId || newLeadListName.trim().length < 2}>Opret leadliste</button></div>
          <p className="assignment-note">Importerede leads placeres på den valgte kampagne og leadliste. Tildel adgang til brugere under Team.</p>
        </div>
        <div className="mapping-header"><div><h2>Match dine kolonner</h2><p>Vælg hvilken CSV-kolonne, der svarer til hvert felt.</p></div><span className="match-count">{Object.values(mapping).filter(Boolean).length} felter matchet</span></div>
        <div className="mapping-grid">{csvFields.map((field) => <label className="mapping-row" key={field.key}><span>{field.label}{["company_name", "phone"].includes(field.key) && <i> * </i>}</span><ArrowRight size={14} /><select value={mapping[field.key] || ""} onChange={(event) => onMapping(field.key, event.target.value)}><option value="">Spring over</option>{headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}</div>
        <div className="preview-table"><div className="preview-heading"><strong>Forhåndsvisning</strong><span>De første 5 rækker</span></div><div className="table-scroll"><table><thead><tr>{csvFields.filter((field) => mapping[field.key]).slice(0, 5).map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={index}>{csvFields.filter((field) => mapping[field.key]).slice(0, 5).map((field) => <td key={field.key}>{row[mapping[field.key]!] || "—"}</td>)}</tr>)}</tbody></table></div></div>
        {!!errors.length && <div className="import-errors"><strong>{errors.length} rækker blev sprunget over</strong>{errors.slice(0, 10).map((item, index) => <span key={index}>Række {item.row}: {item.reason}</span>)}</div>}
        {busy && <div className="progress-block"><div><span>Importerer sikkert …</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>}
        <div className="import-footer"><span><CheckCircle2 size={15} /> Dubletter og ugyldige numre kontrolleres automatisk.</span><button className="button button-primary" disabled={busy || !rows.length} onClick={onImport}>{busy ? "Importerer …" : `Importér ${rows.length.toLocaleString("da-DK")} rækker`} <ArrowRight size={15} /></button></div>
      </div>}
    </div>
    <div className="import-hint"><span><Sparkles size={15} /></span><p><strong>Godt at vide</strong> Dine data bliver kun synlige for dig og dit team. Leads med samme telefonnummer eller firmanavn bliver sprunget over.</p></div>
  </div>;
}

function TeamView({ members, loading, role, campaigns, leadLists, budgets, onInvite, onSave, onSaveBudget }: {
  members: TeamMember[]; loading: boolean; role: Profile["role"]; campaigns: Campaign[]; leadLists: LeadList[];
  budgets: BudgetReport | null;
  onInvite: () => void;
  onSave: (userId: string, fullName: string, role: ManagedRole, campaignIds: string[], leadListIds: string[], callRecordingEnabled: boolean, accessMode: AccessMode, canDialManual: boolean) => void;
  onSaveBudget: (userId: string, campaignId: string | null, weekly: number, monthly: number) => void;
}) {
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Brugere og tildelinger</h1><p>Administrér teamets profiler, kampagner og leadlister ét sted.</p></div>{role === "admin" && <button className="button button-primary" onClick={onInvite}><Plus size={16} /> Invitér kollega</button>}</div>
    <div className="team-summary"><div className="team-summary-main"><span className="team-summary-icon"><Users size={18} /></span><div><strong>{members.length} {members.length === 1 ? "kollega" : "kolleger"}</strong><span>Samlet om de gode samtaler</span></div></div><span className="secure-tag"><CheckCircle2 size={14} /> Privat team</span></div>
    {role === "admin" && !campaigns.length && !loading && <div className="panel admin-setup-note">Opret først kampagner og leadlister under <strong>Importer leads</strong>. Her kan du derefter tildele dem til enkelte brugere.</div>}
    <div className="team-member-list">{members.map((member, index) => role === "admin"
      ? <AdminTeamMember key={member.id} member={member} index={index} campaigns={campaigns} leadLists={leadLists} onSave={onSave} />
      : <div className="panel member-card" key={member.id}><div className={`avatar avatar-${index % 4}`}>{initials(member.full_name || "S")}</div><span className="member-info"><strong>{member.full_name || "Nyt teammedlem"}</strong><small>{friendlyRole(member.role)}</small></span><span className="member-joined">Med siden {formatDate(member.created_at, { month: "short", year: "numeric" })}</span><span className="member-online"><i /> Aktiv</span></div>)}
      {!members.length && <div className="panel empty-panel">{loading ? <span className="skeleton" /> : <EmptyInline title="Dit team begynder med dig" description="Invitér teammedlemmer for at tildele kampagner og leadlister." />}</div>}
    </div>
    {role === "admin" && budgets && <TeamBudgetAdmin report={budgets} onSave={onSaveBudget} />}
    <div className="privacy-foot"><CheckCircle2 size={14} /> Brugere får kun adgang til tildelte kampagner, leadlister og leads. Rolleændringer kræver administratoradgang.</div>
  </div>;
}

function TeamBudgetAdmin({ report, onSave }: {
  report: BudgetReport; onSave: (userId: string, campaignId: string | null, weekly: number, monthly: number) => void;
}) {
  const initialUser = report.members.find((member) => member.role === "salesperson")?.id ?? report.members[0]?.id ?? "";
  const [userId, setUserId] = useState(initialUser);
  const [campaignId, setCampaignId] = useState("");
  const target = report.data.find((item) => item.user_id === userId && item.campaign_id === (campaignId || null));
  const [weekly, setWeekly] = useState("0");
  const [monthly, setMonthly] = useState("0");
  useEffect(() => {
    if (!report.members.some((member) => member.id === userId)) setUserId(initialUser);
  }, [report.members, userId, initialUser]);
  useEffect(() => {
    setWeekly(String(target?.weekly_target ?? 0));
    setMonthly(String(target?.monthly_target ?? 0));
  }, [target?.id, target?.weekly_target, target?.monthly_target]);
  return <section className="panel team-budgets">
    <div className="panel-heading"><div><span className="panel-eyebrow">MÅL OG MOTIVATION</span><h2>Uge- og månedsbudgetter</h2><p>Følg sælgernes aftalte mødemål samlet eller pr. kampagne.</p></div><Target size={18} className="heading-muted" /></div>
    <form className="budget-editor admin-budget-editor" onSubmit={(event) => {
      event.preventDefault();
      if (userId) onSave(userId, campaignId || null, Number(weekly), Number(monthly));
    }}>
      <label>Sælger / booker<select required value={userId} onChange={(event) => setUserId(event.target.value)}>
        <option value="">Vælg bruger …</option>{report.members.map((member) => <option key={member.id} value={member.id}>{member.full_name || "Uden navn"} · {friendlyRole(member.role)}</option>)}
      </select></label>
      <label>Kampagne<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
        <option value="">Alle kampagner samlet</option>{report.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
      <label>Ugentligt mål<input required type="number" min="0" max="10000" value={weekly} onChange={(event) => setWeekly(event.target.value)} /></label>
      <label>Månedligt mål<input required type="number" min="0" max="50000" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></label>
      <button className="button button-primary button-small"><Check size={14} /> Gem aftalt budget</button>
    </form>
    <div className="budget-report-list">{report.members.map((member) => {
      const targets = report.data.filter((item) => item.user_id === member.id);
      return <article className="budget-person-report" key={member.id}>
        <div className="budget-person-heading"><strong>{member.full_name || "Uden navn"}</strong><span>{friendlyRole(member.role)}</span></div>
        {targets.length ? targets.map((item) => <div className="budget-report-row" key={item.id}>
          <div className="budget-report-label"><span>{item.campaign_name ?? "Alle kampagner"}</span><small>{item.weekly_meetings}/{item.weekly_target} uge · {item.monthly_meetings}/{item.monthly_target} måned</small></div>
          <BudgetProgress value={item.weekly_meetings} target={item.weekly_target} tone="week" />
          <BudgetProgress value={item.monthly_meetings} target={item.monthly_target} tone="month" />
        </div>) : <p className="budget-no-target">Intet budget aftalt endnu.</p>}
      </article>;
    })}</div>
  </section>;
}

function BudgetProgress({ value, target, tone }: { value: number; target: number; tone: "week" | "month" }) {
  const percent = target ? Math.min(100, Math.round(value / target * 100)) : 0;
  return <div className={`budget-mini-progress budget-mini-${tone}`} aria-label={`${percent}% af budgetmål`}>
    <i style={{ width: `${percent}%` }} />
  </div>;
}

function MessagesView({ messages, loading, userId, role, campaigns, leadLists, onSend, onMarkRead }: {
  messages: TeamMessage[]; loading: boolean; userId: string; role: Profile["role"];
  campaigns: Campaign[]; leadLists: LeadList[];
  onSend: (input: { title: string; body: string; scope: string; campaign_id?: string; lead_list_id?: string }) => Promise<void>;
  onMarkRead: (id: string) => void;
}) {
  const [scope, setScope] = useState("team");
  const [campaignId, setCampaignId] = useState("");
  const [leadListId, setLeadListId] = useState("");
  const [formCampaignLists, setFormCampaignLists] = useState<LeadList[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (scope !== "lead_list" || !campaignId) {
      setFormCampaignLists([]);
      setLeadListId("");
      return;
    }
    let alive = true;
    void api<{ data: LeadList[] }>(`/api/campaigns/${campaignId}/lists`).then(({ data }) => {
      if (!alive) return;
      setFormCampaignLists(data);
      setLeadListId((current) => data.some((list) => list.id === current) ? current : "");
    }).catch((loadError) => {
      if (alive) setFormError(loadError instanceof Error ? loadError.message : "Leadlister kunne ikke indlæses.");
    });
    return () => { alive = false; };
  }, [scope, campaignId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await onSend({
        title,
        body,
        scope,
        ...(scope === "campaign" ? { campaign_id: campaignId } : {}),
        ...(scope === "lead_list" ? { lead_list_id: leadListId } : {}),
      });
      setTitle("");
      setBody("");
    } catch (sendError) {
      setFormError(sendError instanceof Error ? sendError.message : "Beskeden kunne ikke sendes.");
    } finally {
      setBusy(false);
    }
  }
  const received = messages.filter((message) => message.recipient_user_id === userId);
  const unread = received.filter((message) => !message.read_at).length;
  return <div className="view messages-view">
    <div className="page-heading"><div><span className="eyebrow">SAMARBEJDE PÅ FARTEN</span><h1>Beskeder</h1><p>Vigtige ændringer og hurtige beskeder fra teamet samlet ét sted.</p></div>
      {unread > 0 && <span className="secure-tag"><Bell size={14} /> {unread} ulæste</span>}
    </div>
    {role === "admin" && <section className="panel message-composer">
      <div className="panel-heading"><div><span className="panel-eyebrow">HURTIG BESKED</span><h2>Send en opdatering</h2><p>Modtagerne får beskeden i Nordcall, også næste gang de logger ind.</p></div><MessageSquareText size={18} className="heading-muted" /></div>
      <form onSubmit={(event) => void submit(event)}>
        <label>Send til<select value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="team">Hele teamet</option><option value="campaign">Brugere på en kampagne</option><option value="lead_list">Brugere på en leadliste</option>
        </select></label>
        {scope !== "team" && <label>Kampagne<select required value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setLeadListId(""); }}>
          <option value="">Vælg kampagne …</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select></label>}
        {scope === "lead_list" && <label>Leadliste<select required value={leadListId} onChange={(event) => setLeadListId(event.target.value)} disabled={!campaignId}>
          <option value="">Vælg leadliste …</option>{formCampaignLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select></label>}
        <label>Overskrift<input required minLength={2} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="F.eks. Ny åbningstid på kampagnen" /></label>
        <label>Besked<textarea required maxLength={2000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Skriv ændringen eller den hurtige opdatering …" /></label>
        {formError && <p className="form-error">{formError}</p>}
        <button className="button button-primary" disabled={busy || (scope !== "team" && !campaignId) || (scope === "lead_list" && !leadListId)}>
          <Bell size={15} /> {busy ? "Sender …" : "Send besked"}
        </button>
      </form>
    </section>}
    <section className="messages-inbox">
      <div className="panel-heading"><div><span className="panel-eyebrow">{role === "admin" ? "SENEST SENDT" : "DIN INDBAKKE"}</span><h2>{role === "admin" ? "Teamopdateringer" : "Beskeder til dig"}</h2></div></div>
      {messages.map((message) => {
        const isReceived = message.recipient_user_id === userId;
        const campaignName = campaigns.find((campaign) => campaign.id === message.campaign_id)?.name;
        const listName = leadLists.find((list) => list.id === message.lead_list_id)?.name;
        return <article className={`panel inbox-message ${isReceived && !message.read_at ? "inbox-message-unread" : ""}`} key={message.broadcast_id}>
          <div className="inbox-message-icon"><MessageSquareText size={16} /></div>
          <div className="inbox-message-content"><div className="inbox-message-meta">
            <span>{isReceived ? "Fra din administrator" : `Sendt · ${message.recipient_count ?? 1} modtagere`}</span>
            <time>{formatDate(message.created_at, { day: "numeric", month: "short", year: "numeric" })} · {formatTime(message.created_at)}</time>
          </div>
            <h3>{message.title}</h3><p>{message.body}</p>
            {(campaignName || listName) && <small>{[campaignName, listName].filter(Boolean).join(" · ")}</small>}
          </div>
          {isReceived && !message.read_at && <button className="text-button" onClick={() => onMarkRead(message.id)}>Markér som læst</button>}
        </article>;
      })}
      {!messages.length && <div className="panel empty-panel">{loading ? <span className="skeleton" /> : <EmptyInline title="Ingen beskeder endnu" description={role === "admin" ? "Send en hurtig opdatering til hele teamet, en kampagne eller en leadliste." : "Beskeder fra din administrator vises her."} />}</div>}
    </section>
  </div>;
}

function AdminTeamMember({ member, index, campaigns, leadLists, onSave }: {
  member: TeamMember; index: number; campaigns: Campaign[]; leadLists: LeadList[];
  onSave: (userId: string, fullName: string, role: ManagedRole, campaignIds: string[], leadListIds: string[], callRecordingEnabled: boolean, accessMode: AccessMode, canDialManual: boolean) => void;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [role, setRole] = useState<ManagedRole>(member.role === "admin" ? "admin" : "user");
  const [campaignIds, setCampaignIds] = useState(member.campaign_ids ?? []);
  const [leadListIds, setLeadListIds] = useState(member.lead_list_ids ?? []);
  const [callRecordingEnabled, setCallRecordingEnabled] = useState(member.call_recording_enabled);
  const [accessMode, setAccessMode] = useState<AccessMode>(member.access_mode ?? "all");
  const [canDialManual, setCanDialManual] = useState(member.can_dial_manual ?? true);
  useEffect(() => {
    setFullName(member.full_name);
    setRole(member.role === "admin" ? "admin" : "user");
    setCampaignIds(member.campaign_ids ?? []);
    setLeadListIds(member.lead_list_ids ?? []);
    setCallRecordingEnabled(member.call_recording_enabled);
    setAccessMode(member.access_mode ?? "all");
    setCanDialManual(member.can_dial_manual ?? true);
  }, [member]);
  const toggle = (ids: string[], setIds: (next: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };
  return <section className="panel admin-member-card">
    <div className="admin-member-heading">
      <div className={`avatar avatar-${index % 4}`}>{initials(fullName || "S")}</div>
      <label>Navn<input maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
      <label>Rolle<select className="member-role-select" value={role} onChange={(event) => setRole(event.target.value as ManagedRole)}>
        <option value="user">Bruger</option><option value="admin">Administrator</option>
      </select></label>
      <span className="member-joined">Med siden {formatDate(member.created_at, { month: "short", year: "numeric" })}</span>
    </div>
    {role !== "admin" && <fieldset className="access-mode">
      <legend>Adgang til opkald</legend>
      <label><input type="radio" name={`access-${member.id}`} checked={accessMode === "all"} onChange={() => setAccessMode("all")} />
        <span><strong>Alle kampagner og leadlister</strong><small>Standard. Sælgeren kan ringe på alt i teamet.</small></span></label>
      <label><input type="radio" name={`access-${member.id}`} checked={accessMode === "assigned"} onChange={() => setAccessMode("assigned")} />
        <span><strong>Kun tildelte</strong><small>Sælgeren ser kun de kampagner og leadlister, du vælger nedenfor.</small></span></label>
    </fieldset>}
    {(role === "admin" || accessMode === "all") ? <p className="access-note">{role === "admin" ? "Administratorer har adgang til alt." : "Har adgang til alle kampagner og leadlister. Vælg \"Kun tildelte\" for at begrænse."}</p>
    : <div className="member-assignment-grid">
      <fieldset><legend>Kampagner</legend>
        {campaigns.length ? campaigns.map((campaign) => <label key={campaign.id}>
          <input type="checkbox" checked={campaignIds.includes(campaign.id)} onChange={() => toggle(campaignIds, setCampaignIds, campaign.id)} />
          {campaign.name}
        </label>) : <small>Ingen kampagner oprettet endnu.</small>}
      </fieldset>
      <fieldset><legend>Leadlister</legend>
        {leadLists.length ? leadLists.map((list) => <label key={list.id}>
          <input type="checkbox" checked={leadListIds.includes(list.id)} onChange={() => toggle(leadListIds, setLeadListIds, list.id)} />
          {list.name} · {campaigns.find((campaign) => campaign.id === list.campaign_id)?.name ?? "Kampagne"}
        </label>) : <small>Leadlister vises, når de er oprettet.</small>}
      </fieldset>
    </div>}
    <label className="recording-permission"><input type="checkbox" checked={callRecordingEnabled} onChange={(event) => setCallRecordingEnabled(event.target.checked)} /> Optag denne brugers opkald</label>
    {role !== "admin" && <label className="recording-permission"><input type="checkbox" checked={canDialManual} onChange={(event) => setCanDialManual(event.target.checked)} /> Må ringe til frie numre fra Dialpad</label>}
    <div className="admin-member-footer"><span>{role === "admin" || accessMode === "all" ? "Fuld adgang" : `${campaignIds.length} kampagner · ${leadListIds.length} leadlister tildelt`}</span>
      <button className="button button-secondary button-small" onClick={() => onSave(member.id, fullName, role, campaignIds, leadListIds, callRecordingEnabled, accessMode, canDialManual)}>Gem ændringer</button>
    </div>
  </section>;
}

function SettingsView({ user, profile, onChangePassword }: { user: User; profile: Profile; onChangePassword: (password: string) => Promise<void> }) {
  const isAdmin = profile.role === "admin";
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">GODT AT HAVE STYR PÅ</span><h1>Indstillinger</h1><p>Din konto og de vigtigste oplysninger samlet ét sted.</p></div></div>
    <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-eyebrow">DIN KONTO</span><h2>Profil</h2></div><Users size={17} className="heading-muted" /></div>
      <div className="settings-profile"><div className="avatar avatar-0">{initials(profile.full_name || user.email || "S")}</div><div><strong>{profile.full_name || "Nordcall-bruger"}</strong><span>{user.email}</span></div></div>
      <SettingLine label="Din rolle" value={friendlyRole(profile.role)} /><SettingLine label="Team" value={profile.team_id ? "Aktivt team" : "Intet team"} />
      {isAdmin && <SettingLine label="Loginmetode" value="E-mail og adgangskode" />}
      <PasswordForm onChangePassword={onChangePassword} />
      <div className="settings-callout"><CheckCircle2 size={16} /><p>{isAdmin ? "Adgangskoder og sessioner håndteres sikkert af Supabase Auth." : "Kampagner, ringelister og telefonnummer sættes op af din administrator."} Kontakt din administrator for rolleændringer.</p></div>
    </section>
    {isAdmin ? <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-eyebrow">TELEFONI</span><h2>Opkaldsopsætning</h2></div><Phone size={16} className="heading-muted" /></div>
      <SettingLine label="Telefoniudbyder" value="Telnyx" /><SettingLine label="Forbindelse" value="Serverkonfigureret" /><SettingLine label="Dine opkald optages" value={profile.call_recording_enabled ? "Ja" : "Nej"} />
      <div className="settings-callout settings-warning"><CircleHelp size={16} /><p>Optagelse aktiveres kun af en administrator pr. bruger. Informér deltagerne, og afklar samtykke, formål og opbevaring før optagelse aktiveres.</p></div>
    </section> : <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-eyebrow">DINE OPKALD</span><h2>Klar til at ringe</h2></div><Headphones size={16} className="heading-muted" /></div>
      <SettingLine label="Dine opkald optages" value={profile.call_recording_enabled ? "Ja – informér kunden ved opkaldets start" : "Nej"} />
      <MicrophoneCheck />
      <div className="settings-callout"><CircleHelp size={16} /><p>Brug et headset for den bedste lyd. Tillad mikrofon i browseren, når du bliver spurgt, første gang du ringer.</p></div>
    </section>}</div>
  </div>;
}

function PasswordForm({ onChangePassword }: { onChangePassword: (password: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    setMessage("");
    setFailure("");
    if (password.length < 8) { setFailure("Adgangskoden skal være mindst 8 tegn."); return; }
    if (password !== String(form.get("password_confirmation") ?? "")) { setFailure("Adgangskoderne er ikke ens."); return; }
    setBusy(true);
    try {
      await onChangePassword(password);
      formElement.reset();
      setMessage("Din adgangskode er ændret.");
    } catch (changeError) {
      setFailure(changeError instanceof Error ? changeError.message : "Adgangskoden kunne ikke ændres.");
    } finally {
      setBusy(false);
    }
  }
  return <form className="settings-password" onSubmit={submit}>
    <strong>Skift adgangskode</strong>
    <input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="Ny adgangskode (mindst 8 tegn)" aria-label="Ny adgangskode" />
    <input name="password_confirmation" type="password" autoComplete="new-password" minLength={8} required placeholder="Gentag ny adgangskode" aria-label="Gentag ny adgangskode" />
    {failure && <p className="form-error">{failure}</p>}
    {message && <p className="form-success">{message}</p>}
    <button className="button button-secondary" disabled={busy}>{busy ? "Gemmer …" : "Gem ny adgangskode"}</button>
  </form>;
}

function MicrophoneCheck() {
  const [status, setStatus] = useState<"idle" | "ok" | "denied">("idle");
  async function check() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStatus("ok");
    } catch {
      setStatus("denied");
    }
  }
  return <div className="setting-line"><span>Mikrofon</span>
    {status === "idle" ? <button className="text-button" onClick={() => void check()}>Test mikrofon</button>
      : <strong>{status === "ok" ? "Virker" : "Ingen adgang – tillad mikrofon i browseren"}</strong>}
  </div>;
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return <div className="setting-line"><span>{label}</span><strong>{value}</strong></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-header"><div><span className="eyebrow">NORDCALL WORKSPACE</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Luk dialog"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}
function ModalActions({ onCancel, submit }: { onCancel: () => void; submit: string }) {
  return <div className="modal-actions"><button className="button button-secondary" type="button" onClick={onCancel}>Annuller</button><button className="button button-primary" type="submit">{submit} <ArrowRight size={15} /></button></div>;
}
function EmptyInline({ title, description }: { title: string; description: string }) {
  return <div className="empty-inline"><span className="empty-icon"><Sparkles size={16} /></span><strong>{title}</strong><p>{description}</p></div>;
}
