import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { isLeadStatus, normalizePhone } from "@/lib/leads";

export async function GET(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const params = new URL(request.url).searchParams;
  let query = context.supabase.from("leads").select("*", { count: "exact" }).is("deleted_at", null);
  const search = params.get("q")?.trim().slice(0, 100);
  if (search) {
    const clean = search.replace(/[%,()]/g, " ").trim();
    if (clean) query = query.or(`company_name.ilike.%${clean}%,contact_person.ilike.%${clean}%,phone.ilike.%${clean}%,cvr.ilike.%${clean}%`);
  }
  const status = params.get("status");
  if (isLeadStatus(status)) query = query.eq("status", status);
  if (params.get("city")) query = query.ilike("city", `%${params.get("city")!.slice(0, 80)}%`);
  if (params.get("industry")) query = query.ilike("industry", `%${params.get("industry")!.slice(0, 80)}%`);
  for (const [parameter, column, method] of [
    ["employees_min", "employee_count", "gte"],
    ["employees_max", "employee_count", "lte"],
  ] as const) {
    const value = params.get(parameter);
    if (value !== null) {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 0) return apiError("Ugyldigt medarbejderfilter.");
      query = method === "gte" ? query.gte(column, count) : query.lte(column, count);
    }
  }
  const assignedUser = params.get("assigned_user_id");
  if (assignedUser === "unassigned") query = query.is("assigned_user_id", null);
  else if (assignedUser) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assignedUser)) {
      return apiError("Ugyldigt sælgerfilter.");
    }
    query = query.eq("assigned_user_id", assignedUser);
  }
  for (const [parameter, column, method] of [
    ["last_contacted_after", "last_contacted_at", "gte"],
    ["callback_after", "next_follow_up_at", "gte"],
  ] as const) {
    const value = params.get(parameter);
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return apiError("Ugyldigt datofilter.");
      const dateTime = `${value}T00:00:00.000Z`;
      query = method === "gte" ? query.gte(column, dateTime) : query.lte(column, dateTime);
    }
  }
  const requestedPage = Number(params.get("page") ?? "0");
  if (!Number.isInteger(requestedPage) || requestedPage < 0 || requestedPage > 10_000) return apiError("Ugyldigt sidetal.");
  const pageSize = 100;
  query = query.order("created_at", { ascending: false }).range(requestedPage * pageSize, requestedPage * pageSize + pageSize - 1);
  const { data, error, count } = await query;
  if (error) {
    console.error("Lead list query failed", error.message);
    return apiError("Kunne ikke hente virksomheder.", 500);
  }
  return NextResponse.json({ data, count });
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  const body = await readJson(request);
  const phone = normalizePhone(body?.phone);
  const companyName = typeof body?.company_name === "string" ? body.company_name.trim() : "";
  if (!body || !phone || !companyName || companyName.length > 200) return apiError("Firmanavn og et gyldigt telefonnummer er påkrævet.");
  if (body.employee_count !== null && body.employee_count !== undefined
    && (!Number.isInteger(body.employee_count) || Number(body.employee_count) < 0)) {
    return apiError("Antallet af medarbejdere skal være et heltal på 0 eller derover.");
  }
  const assignedUserId = context.profile.role === "salesperson" ? context.user.id
    : typeof body.assigned_user_id === "string" ? body.assigned_user_id : context.user.id;
  let campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  let leadListId: string | null = null;
  if (body.lead_list_id !== undefined) {
    if (typeof body.lead_list_id !== "string") return apiError("Vælg en gyldig leadliste.");
    const { data: leadList, error: listError } = await context.supabase.from("lead_lists")
      .select("id, campaign_id").eq("id", body.lead_list_id).eq("team_id", context.profile.team_id).maybeSingle();
    if (listError || !leadList) return apiError("Leadlisten blev ikke fundet eller er ikke tildelt dig.", listError ? 500 : 404);
    if (campaignId && campaignId !== leadList.campaign_id) return apiError("Leadlisten tilhører ikke den valgte kampagne.");
    campaignId = leadList.campaign_id;
    leadListId = leadList.id;
  }
  if (!campaignId) return apiError("Vælg en kampagne til virksomheden.");
  const { data: campaign, error: campaignError } = await context.supabase.from("campaigns")
    .select("id").eq("id", campaignId).eq("team_id", context.profile.team_id).maybeSingle();
  if (campaignError || !campaign) {
    return apiError("Kampagnen blev ikke fundet eller er ikke tildelt dig.", campaignError ? 500 : 404);
  }
  const { data, error } = await context.supabase.from("leads").insert({
    team_id: context.profile.team_id,
    company_name: companyName,
    phone,
    cvr: typeof body.cvr === "string" ? body.cvr.trim().slice(0, 20) : null,
    contact_person: typeof body.contact_person === "string" ? body.contact_person.trim().slice(0, 150) : null,
    email: typeof body.email === "string" ? body.email.trim().slice(0, 254) : null,
    website: typeof body.website === "string" ? body.website.trim().slice(0, 500) : null,
    address: typeof body.address === "string" ? body.address.trim().slice(0, 200) : null,
    city: typeof body.city === "string" ? body.city.trim().slice(0, 100) : null,
    industry: typeof body.industry === "string" ? body.industry.trim().slice(0, 100) : null,
    employee_count: Number.isInteger(body.employee_count) && Number(body.employee_count) >= 0 ? body.employee_count : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : "",
    status: isLeadStatus(body.status) ? body.status : "new",
    assigned_user_id: assignedUserId,
    campaign_id: campaign.id,
    lead_list_id: leadListId,
    created_by: context.user.id,
  }).select().single();
  if (error) {
    console.error("Lead creation failed", error.message);
    return apiError("Virksomheden kunne ikke oprettes.", 400);
  }
  await writeAudit(context, "created", "lead", data.id);
  return NextResponse.json({ data }, { status: 201 });
}
